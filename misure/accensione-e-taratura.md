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
| Modulo penna | **montato e tarato**: quattro angoli (17/25/34/90), penna stretta, primo disegno a mano riuscito il 2026-10-22 |
| FluidNC sul firmware | **v4.1.1 installata il 2026-10-22**, configurazione verificata con `$CD`. Assi e servo non ancora mossi |
| `cnc2d-config.yaml` | **caricato e verificato sulla macchina** (2026-10-22): `$CD` rilegge tutti i numeri, compresi `gpio.26:low`, gli impulsi 2222/1500 e `startup_line0` |
| SLICER caricato sulla macchina | **no**, gira solo in modalità finta nel browser |
| Pannello manuale dentro il SLICER | impalcatura presente, tutta disabilitata |
| Profilo macchina e profilo di stampa | **fatti** (2026-10-19): tab Impostazioni, salvataggio nel browser, esportazione JSON |
| Generazione di `config.yaml` dal profilo | **fatta**: un pulsante nella tab Impostazioni |
| Blocchi di homing stampati | **fatti**, rifatti e rimisurati (2026-10-22): scostamento X 4,300 mm, Y 4,977 |
| Homing a mano nella dashboard | **fatto** (2026-10-19): libera i motori, appoggi i carrelli, riattiva e azzera |
| Popup di inizio stampa | **fatti** (2026-10-20): tre passi, origine macchina / penna / foglio |
| Invio del programma alla macchina | **da costruire** |

**A1 e A2 sono fatti**: le corse il 2026-10-20, i tre angoli del servo il
2026-10-21. Quello che resta di Fase A è A4÷A6 — flashare FluidNC e tarare il
rapporto disegnando — e per quelli serve la stampa di collaudo. Fase B diventa
vera quando l'invio del programma alla macchina è costruito.

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
fisico: ci si appoggia il carrello e si azzera. Quando ci sono, si prendono due
numeri.

**La corsa disponibile dall'home**, con la dashboard: appoggia al blocco,
*Homing completato*, porta l'asse all'altra battuta a passo piccolo sul finale,
leggi. Lo scostamento del blocco dalla battuta è la corsa totale meno questa.

**La ripetibilità dell'appoggio, col calibro.** Non col DRO: per ripetere
l'appoggio bisogna liberare i motori, e liberare i motori cancella quello che
il contatore sa — uno stepper non misura, conta gli impulsi che gli arrivano.
Si fissa un riferimento, si appoggia il carrello e si misura la distanza fra
riferimento e faccia del carrello; cinque o sei appoggi, allontanando ogni
volta. Quella dispersione è il margine di sicurezza minimo — oggi il margine
sta a 8 mm per pura prudenza, e questo è l'unico modo di sostituirlo con un
numero vero.

## A2. I tre angoli del servo — si fa con la DASHBOARD, non con il SLICER

Questo passo viene **prima** di flashare FluidNC, per un motivo pratico: la
dashboard ha già lo slider manuale del servo, parte in stato `free` (nessun
impulso, squadretta morbida) e ha la rampa che avvicina l'angolo di pochi gradi
per volta. FluidNC non ha niente di tutto questo. È lo strumento giusto, e usa
lo stesso pin — `gpio.32` — che FluidNC dichiarerà come `rc_servo`, quindi i
numeri che trovi qui valgono tali e quali.

### Prima di cominciare: contro cosa stringi la penna

L'angolo di **penna abbassata** non è una misura: è il gesto con cui stringi la
penna nei morsetti. Il riferimento è quindi uno solo, e si dice in una riga:

> **il piano su cui il foglio appoggerà davvero quando stampi.**

Sulla macchina com'è montata oggi quel piano è **la tavola stessa**: il piano è
unico, il foglio ci si appoggia sopra e la penna lo raggiunge. Quindi si stringe
la penna lì, con un foglio sotto la punta, e non serve nessuno spessore.

**Sui 44 mm, che non esistono più.** In progetto c'era una *piattaforma* alta
44 mm, decisa il 2026-10-06 quando il modulo penna non era ancora disegnato: il
punto più basso del carrello Y sta a Z 46,68 sopra la tavola, e un piano carta a
Z ≈ 44,2 avrebbe lasciato 2,5 mm di franco. **Eliminata il 2026-10-21**: col
modulo Tratto Pen attaccato alla testina dell'asse X lo spazio verticale libero
è meno di quei 4 cm, quindi la piattaforma non ci starebbe sotto.

Nessuno spessore, quindi, e nessuna quota da rispettare: la quota assoluta non è
mai stata un vincolo, perché a regolarla è la penna che scorre nei morsetti —
motivo per cui i morsetti sono un serraggio e non un riferimento di quota.

### Una precauzione sul servo, prima di toccare qualsiasi cosa

Dopo **Rilascia** il servo non riceve impulsi e la squadretta si muove dove
vuole: **nessuno sa più dov'è davvero**. Il primo comando dopo un rilascio
riparte dall'ultimo angolo comandato, non da quello reale, e può quindi essere
un salto — che a due gradi dalla battuta è esattamente quello che non vuoi.

Regola: dopo ogni *Rilascia*, **il primo comando è verso il centro corsa**, mai
verso la battuta. E alza la *dolcezza del movimento* nella tab Motore, così il
servo ci arriva piano invece che di scatto.

**Cosa fai:**

1. Monta il modulo penna **senza la penna nei morsetti**.
2. Accendi. La dashboard parte col servo in `free`: la squadretta è morbida e
   non tiene nessuna posizione. È voluto — un servo che appena riceve corrente
   va in battuta contro un vincolo meccanico assorbe moltissimo.
3. Con lo slider porta il servo a **metà corsa** e guarda dove si trova il
   modulo. Da qui in avanti si lavora **coi pulsanti −1° e +1°**, non più con lo
   slider: trascinando si perde il conto di dove si è, premendo lo si sa sempre.

   **Il verso.** Sul modulo montato il 2026-10-21 l'accoppiamento esce
   invertito: facendo crescere l'angolo fisico la penna **scende**. La spunta
   *Verso del servo invertito*, nella tab Motore, è attiva per impostazione
   predefinita e converte in un punto solo. Con lei i gradi che vedi, che salvi
   e che metti nel profilo sono **gradi logici — più gradi = penna più in alto**,
   e resta valida ovunque la regola `battuta < abbassata < alzata`.

   **La stessa spunta esiste nel profilo del SLICER** e deve concordare: se i
   due non vanno d'accordo, la dashboard alza e FluidNC abbassa.

   Verifica in due secondi prima di cominciare: premi `+1°` qualche volta e
   guarda che la penna **salga**. Se scende, la spunta è dalla parte sbagliata.

4. **ANGOLO DI BATTUTA — l'unico dei tre che non è un conto.**

   È una proprietà del meccanismo, non della penna: si prende **una volta sola**,
   al montaggio, e non cambia più finché non smonti il modulo.

   **Fatto il 2026-10-21, e non misurandolo: imponendolo.** Il modo migliore è
   anche il più semplice — si porta la dashboard sull'angolo che si vuole, si
   appoggia il modulo ai blocchi sotto il suo solo peso, e si calza il pignone
   sull'albero del servo. Da quel momento la battuta **è** quell'angolo, per
   costruzione, senza misurare niente. Due avvertenze, tutte e due imparate
   sbagliando:

   - **Non premere mentre incastri.** Se spingi il modulo sui blocchi ti
     costruisci dentro un precarico, e la battuta reale finisce più in alto di
     quella che hai scritto.
   - **Non mettere un angolo troppo basso.** Col verso invertito l'angolo
     logico piccolo è l'impulso grande: a 1° l'impulso è 2489 µs, fuori dai
     500÷2400 di specifica dell'SG90. Il primo tentativo era a 1°, e il pignone
     è finito calzato col servo già contro il proprio fermo interno — da lì non
     si poteva più distinguere il fermo del meccanismo da quello del servo. Il
     secondo montaggio è a **19°**, cioè 2289 µs. Qualunque valore fra **13° e
     30°** va bene: 19 non è un bersaglio da centrare, è il centro di una
     finestra larga, e l'incastro del pignone è quantizzato (~19° per spline
     dell'SG90) quindi non si cade mai esattamente sul numero scelto. Quello che
     la pagina segna nel momento in cui il pignone si siede **è** la battuta:
     scrivilo e basta.

   **Fatto il 2026-10-22, e la misura ha corretto il montaggio: la battuta è
   17, non 19.** I due gradi sono quello che il modulo aveva ancora da scendere
   quando il pignone è stato calzato — abbastanza poco da non vedersi a occhio,
   abbastanza da contare. Vale la misura. Conseguenza sui 25° di penna
   abbassata: nessuna, perché quello non è battuta + 6 ma l'angolo a cui la
   penna è stata stretta; semplicemente ora è battuta + 8, cioè c'è più riserva
   verso il basso di quanta ne era stata prevista.

   Dopo l'incastro, la **verifica** — ed è questa che il primo montaggio non
   permetteva. Infila una **striscia di carta** (un decimo di millimetro) fra un
   cuscinetto inferiore e il suo blocco, poi scendi di **un grado solo** coi
   pulsanti ±1°. Se la striscia resta pinzata e niente si muove, il fermo sono i
   blocchi, e lo sai con certezza perché a quell'impulso il servo ha ancora
   strada davanti. **Un grado, non più:** 1° = 0,33 mm, quasi tutti assorbiti
   dai 0,30 mm di gioco d'ingranamento; quattro o cinque gradi sarebbero 1,3 mm
   di spinta contro un fermo rigido, e un SG90 in stallo a 18,75 mm di raggio fa
   circa 1 kg sulla cremagliera. I pulsanti ±1° arrivano a 2° sotto la battuta e
   non oltre — slider e comandi Alza/Abbassa non ci arrivano affatto.

   **Se invece la battuta la stai cercando** perché il pignone è già calzato e
   non sai a che angolo, allora si misura, e si misura così: scendi di un grado
   per volta. Per accorgerti del contatto **non aspettare che
   il servo ronzi**: infila una **striscia di carta** (un decimo di millimetro)
   fra un cuscinetto inferiore e il suo blocco, e tirala a ogni grado. Quando
   non esce più, sei al contatto.

   Segna **l'ultimo grado in cui la carta usciva ancora**. È il valore
   conservativo: se sbagli, sbagli stando più in alto della battuta vera. E
   controlla l'impulso che ne esce: se è sopra 2400 µs, non hai trovato la
   battuta del meccanismo, hai trovato il fermo interno del servo, e il pignone
   va spostato di uno spline.

   Poi **risali subito di due o tre gradi**. Non lasciare il servo in battuta:
   è lì che si spianano gli ingranaggi dell'SG90.

5. **ANGOLO DI PENNA ABBASSATA — non si misura, si impone.**

   Porta il servo a **battuta + 6°**, che col montaggio del 2026-10-21 vuol dire
   **25°**. Metti un foglio sul piano su cui stamperai davvero — oggi la tavola.
   Infila la penna nei morsetti finché la punta **tocca il foglio**, e stringi.

   Da quel momento `abbassata = battuta + 6°` **per costruzione**, perché l'hai
   costruita così. Il giorno che cambi penna, rifai lo stesso gesto allo stesso
   angolo e il numero resta quello: non si rimisura niente.

   Perché proprio 6°, cioè 1,96 mm: è la riserva **verso il basso**, per il
   giorno che usi una carta più sottile o infili la penna un millimetro più
   corta e il contatto cade più in basso di oggi. Non costa niente tenerla
   generosa.

6. **ANGOLO DI PENNA ALZATA — è un conto.**

   `alzata = abbassata + 9°`, cioè **34°** e 2,945 mm di penna.

   Il criterio di sotto è la banda morta del servo (0,90° = 0,295 mm): con dieci
   bande morte dentro, l'alzata ripete entro il 10%. Un'alzata da 1 mm sarebbe
   tre bande morte, cioè ±30%, e non servirebbe a niente.

   Il criterio di sopra lo decide **la prova 7 del disegno di collaudo**: se
   negli spazi fra i trattini resta un segno, l'alzata non basta a scavalcare il
   fuori-piano e va aumentata.

7. **Verifica prima di scrivere i numeri nel profilo.**

   - `battuta < abbassata < alzata` — il software lo controlla, ma guardalo
     anche tu;
   - alla quota di **alzata**, la punta deve staccarsi dal foglio in modo
     visibile;
   - abbassa, alza e riabbassa tre volte: la punta deve tornare **nello stesso
     posto**. Se no, c'è gioco nel giunto o la penna scivola nei morsetti.

8. **POSIZIONE TAPPO — un angolo, due lavori.**

   È la quota a cui la penna sale **a fine stampa e all'accensione**, per
   lasciare spazio a infilare il tappo senza togliere la penna dai morsetti.
   Sulla macchina montata vale **90°**, cioè 21,27 mm sopra il contatto, ed è
   il massimo prima che lo stadio flottante esca dalle guide — quindi lo stesso
   numero è anche il **tetto** del meccanismo. La dashboard non ci va oltre, né
   con lo slider né coi pulsanti da un grado.

   Si misura una volta, come la battuta e al contrario: si sale di un grado per
   volta finché i cuscinetti arrivano in cima, e si segna **l'ultimo grado
   prima**.

   E poi la regola che va rispettata ogni volta: **il tappo si toglie prima di
   qualunque cosa muova la penna.** Il primo popup di stampa lo ricorda, la
   dashboard mostra un avviso finché la penna è in posizione tappo e chiede
   conferma prima di farla scendere, e il `config.yaml` lo dice nel commento
   della riga di avvio.

**Quello che devi ottenere:** quattro numeri in gradi, nell'ordine
battuta < abbassata < alzata < tappo. Sulla macchina montata sono
**17 / 25 / 34 / 90**, e sono già nel profilo e nel `config.yaml`. La corsa meccanica
totale della guida è 26,350 mm = **80,5°**, e noi ne usiamo 15: ci sta
larghissima, e non c'è rischio di arrivare al limite superiore. Se i tre numeri
non stanno dentro quella finestra, c'è qualcosa che non torna nel montaggio.

**Nel profilo** (tab Impostazioni → Penna) vanno **tutti e tre**, ma quello che
conta ricordare è che solo il primo è una misura. Gli altri due sono battuta +
6 e battuta + 15.

## A2.1 Il gioco d'ingranamento: perché NON si misura

Qui c'era una procedura per misurare col calibro i 0,30 mm di gioco della
coppia cremagliera/pignone. È stata tolta il 2026-10-22, su obiezione
dell'utente, e questa nota resta per non rimetterla in lista fra un mese.

**Il modulo costruito è in presa rigida.** Da `modulo-penna/schema.html`: *«il
giunto a gioco morto da 6 mm non c'è: la quota della punta è l'angolo del
servo, in presa rigida nei due versi»*. La penna appoggia col proprio peso solo
**dentro** i 0,30 mm di gioco — che sono **0,92° di servo**, mentre la banda
morta del servo stesso vale circa 0,9°. È una finestra larga un passo: non ci
si può mirare dentro con uno strumento che ha quel passo. Fuori di lì la quota
la impone il servo.

Per cui la misura non serve, e per tre motivi che vale la pena tenere scritti:

1. **nessuna impostazione dipende da quel numero** — non entra in un conto, non
   cambia un angolo, non va nel `config.yaml`;
2. **è una misura difficile per quello che vale**: 0,30 mm a mano, dove la forza
   del dito sposta la lettura più dello strumento;
3. **la condizione che ci farebbe agire chiede un altro numero.** La decisione
   del 2026-10-17 dice: *da rivedere se alla prima stampa il tratto cambia
   spessore secondo il punto del foglio — e in quel caso la banda morta da
   aggiungere non è 0,3 mm ma quanto è fuori piano il piano carta*.

**Chi fa questo lavoro al posto suo:** la **prova 7** del disegno di collaudo
(se negli spazi fra i trattini resta un segno, l'alzata non basta) e la **prova
11** (se il tratto cambia spessore da una zona all'altra, il piano è fuori
squadro più di quanto la catena assorba). Misurano la stessa cosa dove conta,
sulla carta e con la penna vera.

Una cosa da tenere d'occhio: al montaggio l'utente ha riportato *«accoppiamento
perfetto, gioco vicinissimo allo 0»*. Se vale anche per l'ingranamento e non
solo per i cuscinetti, quella cedevolezza da 0,30 mm **potrebbe non esserci** —
ed è di nuovo la prova 11 a dirlo.

---

## A3. Tradurre i tre angoli in microsecondi per FluidNC

La dashboard mappa 0÷180° su 500÷2500 µs, ma i gradi che mostra sono **logici**
(più gradi = penna più in alto) mentre l'accoppiamento è invertito, quindi la
formula ha il segno meno:

```
µs = 2500 − gradi × 11,1111
```

**Attenzione al verso**: con `µs = 500 + gradi × 11,1111` escono i numeri
dell'angolo fisico, e il servo fa l'opposto di quello che ci si aspetta.

Sulla macchina montata:

| | gradi logici | µs |
|---|---|---|
| battuta | 17 | 2311 — **non va nel YAML** |
| penna abbassata | 25 | 2222 → `min_pulse_us` |
| penna alzata | 34 | 2122 — **una quota intermedia**, non un estremo |
| posizione tappo | 90 | 1500 → `max_pulse_us` |

**L'estremo alto è il tappo, non l'alzata.** `mapConstrain` tronca tutto quello
che cade fuori dai due impulsi, quindi se il massimo fosse l'alzata la posizione
tappo sarebbe irraggiungibile e il comando non farebbe niente. L'arco va dal
contatto al tappo, e l'alzata di lavoro diventa una quota in mezzo.

Nel YAML va:

```yaml
    # (90 − 25) × 0,32725: dal contatto al tappo, in mm veri di penna
    max_travel_mm: 21.271
      rc_servo:
        # min_pulse_us va al FONDO corsa, Z−21.271: penna sul foglio
        min_pulse_us: 2222
        # max_pulse_us va in CIMA, Z0: posizione tappo
        max_pulse_us: 1500
```

### Le quote Z sono negative, e non è una scelta

`max_travel_mm` è positivo, ma **le quote da comandare sono negative**. Senza
finecorsa e senza homing FluidNC mette lo zero macchina all'**estremo alto**
della corsa e fa correre il resto in negativo: verificato con `$CD` il
2026-10-22, «`Axis Z (-21.281, 0.010)`».

Quindi `min_pulse_us` non è «la quota zero»: è l'estremo **inferiore**
dell'intervallo dichiarato, cioè Z−21.271. E `max_pulse_us` è Z0.

| quota macchina | angolo | cosa è |
|---|---|---|
| `Z0` | 90° | posizione tappo, in cima |
| `Z-18.326` | 34° | penna alzata di lavoro |
| `Z-21.271` | 25° | punta sul foglio |

**Una quota positiva non è «più in alto»: è fuori corsa.** `RcServo` mappa la
posizione **macchina** con `mapConstrain()`, che non rifiuta quello che cade
fuori — lo **tronca** all'estremo. Un `G0 Z2.945` non alza la penna di 2,945 mm:
diventa Z0, la posizione tappo. È esattamente il motivo per cui il 2026-10-22 la
penna non si muoveva pur avendo gli impulsi giusti nel file: ogni quota che
mandavamo finiva sullo stesso impulso.

**Regola del parser, che costa un'ora se la si scopre sulla macchina:** FluidNC
**non accetta commenti in coda a una coppia `chiave: valore`**. Una riga come
`max_travel_mm: 21.271   # dal contatto al tappo` gli fa ignorare la chiave. I
commenti stanno su righe loro, e basta. Il file generato dalla tab Impostazioni
rispetta la regola; se lo modifichi a mano, rispettala anche tu.

E per far salire la penna in posizione tappo a ogni accensione:

```yaml
macros:
  startup_line0: G90 G0 Z0
```

**FluidNC parte assumendo `Z0`**, e con questa convenzione `Z0` *è* la posizione
tappo: quello che la macchina crede e dove il servo si trova coincidono, e
l'istante fra accensione ed esecuzione della riga non muove niente. La riga
resta perché rende la quota esplicita, non perché corregga qualcosa.

Quello che va tolto prima di dare corrente è comunque il **tappo**: non per
l'accensione, ma perché il primo comando che abbassa la penna — un jog, il
popup dell'altezza di contatto, una stampa — ci arriva col tappo infilato e la
corsa che manca la paga il meccanismo.

`min_pulse_us` **maggiore** di `max_pulse_us` non è un errore di battitura: è il
modo in cui FluidNC inverte un servo. Dal sorgente di `RcServo.cpp` — «The
rotation can be inverted by swapping the values» — e la mappatura è una
interpolazione lineare senza controlli sull'ordine dei due estremi.

Così `Z0` = posizione tappo e `Z-21.271` = penna appoggiata, e **Z è in
millimetri veri di penna** invece che in unità arbitrarie: la differenza fra due
quote è la distanza vera percorsa dalla punta.

L'angolo di **battuta** non va nel YAML: va nel profilo del SLICER come limite,
e serve a una cosa sola — il software non deve mai poter comandare una Z che lo
raggiunga.

## A4. Flashare FluidNC — e qui si perde la dashboard

**Da sapere prima di premere:** FluidNC è un firmware intero. Flasharlo
**cancella** lo sketch della dashboard. Si torna indietro riflashando lo sketch,
ma non convivono. Quindi A1 va chiuso prima.

### C'è un secondo ESP32 con FluidNC già installato: conviene scambiarlo?

**No, conviene flashare quello montato.** Il vecchio ESP32 del 2026-09-21 ha
FluidNC 4.1.0, la rete già configurata e l'hostname `cnc2d`, quindi sembra una
scorciatoia. Non lo è, per tre motivi in ordine di peso:

1. **Il `config.yaml` va caricato comunque.** Quello sul vecchio è di settembre:
   `steps_per_mm: 80` (l'ipotesi a cinghia), `max_travel_mm: 300`, nessun numero
   del servo, nessun `:low` su X. Il caricamento del file è il lavoro vero, ed è
   identico nei due casi.
2. **Il circuito è stato rifatto attorno all'ESP32 montato.** I suoi pin sono
   provati contro *questo* cablaggio, per settimane; quelli del vecchio contro
   un cablaggio che non esiste più. Mettere una scheda non verificata su quindici
   connessioni verificate scambia un rischio piccolo con uno grande.
3. **Quello che si risparmia sono tre minuti di flash** più le credenziali WiFi.

Se lo scambi lo stesso, una cosa da controllare prima di tutto: che sia lo
**stesso modulo a 30 pin con lo stesso ordine di piedini**. La configurazione
indirizza i `gpio.`, non le posizioni fisiche: su un modulo a 36 pin il
`gpio.32` del servo finisce da un'altra parte.

### Prima di flashare: due minuti con la dashboard che hai già

Da qui in poi i pulsanti ±1° non ci sono più, quindi quello che va guardato col
servo va guardato adesso.

**Verifica la posizione tappo.** Porta il servo a 90° e controlla che lo stadio
flottante sia ancora dentro le guide, con un filo di margine. Quel numero
diventa `max_pulse_us` **e** la riga di avvio: se è ottimista, a ogni accensione
FluidNC ci va contro.

Non serve invece riflashare la dashboard per avere il pulsante *Tappo*: fa
comodo solo finché la dashboard c'è, e sta per sparire. Quello che resta — il
profilo, il `config.yaml`, i popup del SLICER — ce l'ha già.

**Cosa fai:**

1. **La penna resta nei morsetti, il tappo no.** Togliere la penna vorrebbe dire
   rifare il gesto di A2 passo 5, cioè ritarare il contatto: non si fa per un
   flash. Quello che va tolto è il **tappo**: non per l'istante
   dell'accensione — lì FluidNC assume `Z0`, che è la posizione tappo, e il
   servo sta già in cima — ma perché il **primo comando che abbassa la penna**
   ci arriva col tappo infilato. Con la penna nuda non succede niente: il
   contatto è stato tarato con un foglio sotto, quindi sulla tavola nuda la
   punta resta un decimo sopra. Col tappo, la corsa che manca la paga il
   meccanismo.
2. Flash dal web installer (`installer.fluidnc.com`, Chrome o Edge: usa la
   WebSerial). **Versione 4.1.1** (2026-09-25). Processore `esp32` (DevKit
   WROOM-32 a 30 pin), variante **wifi**, tipo **fresh-install**, interfaccia
   **WebUI-2**.

   La regola resta «non l'ultima per inerzia», ma qui il changelog l'ha
   giustificata: la 4.1.1 è una **patch** sulla 4.1.0 — la versione su cui la
   configurazione era stata validata il 2026-09-21 — e nessuna voce tocca i
   nomi dei campi. Tre correzioni cadono invece esattamente dove lavoriamo:
   un bug di generazione dei comandi **macro** (`Macro::addf`, va_list
   riusata), un descrittore di **upload** non rilasciato quando un
   trasferimento viene abbandonato, e i **riavvii del watchdog** durante le
   operazioni sui file. Macro e upload sono due cose che usiamo dal primo
   minuto: la riga di avvio del servo è una macro, e i programmi si caricano
   dalla WebUI.

   Resta comunque `$CD` a fare da rete: se una versione cambiasse un nome di
   campo, è lì che si vede.

   **Velocità di installazione: 115200, non i 921600 proposti.** Il
   convertitore USB di questa scheda è un **CH340** (`VendorID 0x1a86,
   ProductID 0x7523` nel log di esptool), e a 921600 il trasferimento del
   firmware grande si è interrotto all'1% il 2026-10-22, lasciando la scheda in
   boot loop. I file piccoli — tabella delle partizioni, bootloader — passano
   lo stesso: è l'immagine da 1,1 MB che non ce la fa. Lo dice esptool stesso
   nel log, due righe dopo aver cambiato baud: *«If the chip does not respond
   to any further commands, consider using a lower baud rate»*.

   A 115200 l'immagine impiega un minuto e mezzo invece di dodici secondi.
   Vale la pena non doverlo rifare.

   Se fallisce anche a 115200, nell'ordine: **cavo USB più corto** e porta
   direttamente sul PC, niente hub; poi **sfila l'ESP32 dalla breadboard** e
   flashalo nudo. Con i 12 V spenti è l'USB ad alimentare tutta la logica
   della breadboard — driver, LED, servo — e durante la scrittura un calo di
   tensione resetta la scheda.

   Una scheda interrotta a metà flash **non è rotta**: il boot loop è la
   conseguenza di una flash incompleta e sparisce quando la scrittura finisce.

   Un fresh-install cancella anche le impostazioni di rete, quindi la macchina
   riparte in access point e vanno rimesse: **modalità STA, hostname `cnc2d`**,
   così l'indirizzo resta `http://cnc2d.local` come prima.

3. Carica `cnc2d-config.yaml`, **salvandolo col nome `config.yaml`**: è il nome
   che FluidNC cerca da solo. Se preferisci tenere il nome lungo, attivalo con
   `$Config/Filename=cnc2d-config.yaml` e riavvia con `$Bye` — il pulsante
   "seleziona configurazione" del browser dei file non ha avuto effetto la volta
   scorsa, il comando da terminale sì.
**Esito del 2026-10-22:** `$CD` ha restituito tutti i numeri giusti — `steps_per_mm`
33.952999 su entrambi gli assi, `max_travel_mm` 253.231995 e 238.063995,
`direction_pin: 'gpio.26:low'` su X, `rc_servo` su gpio.32 con 2222 e 1500,
`max_travel_mm` 21.271 su Z, `must_home: false`. (La `startup_line0` letta
allora era `G90 G0 Z21.271`: è la riga che la correzione delle quote negative ha
poi sostituito con `G90 G0 Z0` — vedi A3.)
Nessuna chiave ignorata: il timore dei commenti in coda era fondato ma il file
generato è pulito.

Due cose lette nel dump che non sono nostre e vanno sapute:

- **`idle_disable: true`** compare su ogni asse ed è un valore di default. Il
  comando globale resta `stepping: idle_ms`, e **255 significa «non disabilitare
  mai»** — è la convenzione ereditata da grbl, dove il parametro era a 8 bit.
  Con l'origine messa a mano con `G92` è esattamente quello che serve: un motore
  che si ammorbidisce perde la posizione in silenzio.
- **`Axis X (-253.261, 0.029)`**: FluidNC mette lo zero macchina all'estremo
  positivo e fa correre la corsa in negativo, perché non c'è homing configurato.
  Le coordinate macchina si leggeranno negative, e non è un guasto.

  **Correzione del 2026-10-22, più tardi:** qui era scritto «non cambia
  niente — l'origine la dà `G92` e i limiti software sono spenti», ed era
  sbagliato. Su X e Y è vero. **Su Z no**, e il motivo è che `soft_limits: false`
  spegne i limiti del *pianificatore*, non il `mapConstrain()` dentro `RcServo`,
  che lavora sulla posizione **macchina** e tronca. `Axis Z (-21.281, 0.010)`
  voleva dire che ogni quota positiva diventava Z0. La penna immobile di quel
  pomeriggio è stata questa riga letta e archiviata troppo presto.

4. **`$CD` — rileggi la configurazione che FluidNC ha davvero capito.** Non è
   una formalità: il suo parser **ignora le chiavi che hanno un commento in coda**,
   e una `steps_per_mm` ignorata non dà errore, dà una macchina che si muove
   sbagliato. Controlla che ci siano i numeri giusti su `steps_per_mm`,
   `max_travel_mm` e i due `pulse_us`.
5. **Verso degli assi, prima di qualunque altra cosa.** Un movimento su X deve
   muovere **il carrello lungo la trave**; uno su Y deve muovere **tutto il
   portale**. Su X il file dichiara `direction_pin: gpio.26:low` e quel `:low`
   non è mai stato provato sulla macchina: se l'asse va al contrario, è lì.
6. **Il servo, dalla WebUI:** `G0 Z-21.271` deve abbassare la penna, `G0 Z0`
   deve portarla in posizione tappo, `G0 Z-18.326` è l'alzata di lavoro. Se fa
   il contrario, `min_pulse_us` e `max_pulse_us` sono scambiati rispetto al
   verso del servo.

   **Le quote sono negative: provane una positiva e non succede niente**, perché
   `mapConstrain` la tronca su Z0 — e «non succede niente» è indistinguibile da
   un servo guasto o da un filo staccato. Se vuoi un movimento di prova veloce,
   `G0 Z-3` è dentro la corsa e si vede.

## A4.1 La prima stampa non è il collaudo

Il disegno di collaudo è 466 tratti e più di venti minuti di macchina: non è il
programma con cui si scopre che un asse va al contrario.

1. **Origine a mano**, in questo ordine:

   ```
   $MD                      libera i motori (e' $Motor/Disable; $MD=X per uno solo)
   ... appoggi i carrelli ai blocchi, senza forzarli ...
   G92 X0 Y0                lo zero e' il punto ai blocchi
   G90 G0 X5 Y5 F1000       riabilita i motori e va al punto home
   ```

   **Nessun comando riabilita i motori**: lo fa automaticamente il primo
   comando di movimento. Per questo l'ultima riga non e' facoltativa — finche'
   non la mandi i motori restano molli, e una spinta accidentale sposta i
   carrelli senza che nessun impulso lo racconti: lo zero appena messo
   diventerebbe falso in silenzio.

   **Correzione del 2026-10-22:** qui era scritto l'ordine opposto — prima un
   jog minimo `$J=G91 X0.01 F100` per riabilitare, poi `G92` — e sono due
   errori. Il primo e' aritmetico: con 33,953 passi/mm **un passo vale 0,02945
   mm**, quindi 0,01 mm fa 0,34 passi, arrotondati a **zero**. Un jog che non
   muove niente non e' detto che riabiliti niente. Il secondo e' di merito:
   qualunque jog prima del `G92` sposta il carrello via dai blocchi, e lo zero
   finisce dove il carrello e' arrivato invece che sui blocchi — 0,1 mm sono
   il doppio della ripetibilita' dell'appoggio (0,05 mm), quindi non si
   assorbono. Mettendo il `G92` **prima**, i 5 mm del movimento verso il punto
   home sono contati e lo zero resta esatto.
2. **Un quadrato piccolo**, 50 mm, disegnato da qualche parte in mezzo al
   foglio. Serve a tre cose: che i versi siano giusti, che la penna segni per
   tutto il perimetro, e che il quadrato chiuda dove è partito.
3. **Poi il collaudo:** `gcode/collaudo.gcode`, già generato con i numeri veri
   (contatto Z−21.271, alzata Z−18.326, tappo Z0). Si carica e si lancia dalla
   WebUI di FluidNC — l'invio del programma dal SLICER non è ancora costruito.

**Ogni programma finisce al punto home, non sullo zero.** L'ultimo
spostamento è un `G0 X5 Y5`, poi la penna sale a `Z0`. Non è un dettaglio
estetico: finire sullo zero vuol dire lasciare i carrelli **appoggiati ai
blocchi**, e un carrello fermo contro il riferimento prima o poi lo sposta —
il riferimento è la cosa che non deve muoversi. Il punto home sta cinque
millimetri dentro da entrambi, ed è anche la condizione in cui il gioco della
cremagliera è preso sempre dalla stessa parte, quindi il movimento successivo
parte da uno stato noto. Un file che termina con `X0 Y0` è stato generato
prima del 2026-10-22 e va rigenerato.

**Come si riconosce un file generato con la convenzione vecchia:** le righe
`G1 Z0` e `G0 Z2.945` invece di `G1 Z-21.271` e `G0 Z-18.326`. Un file così non
sbaglia il disegno: non disegna affatto, perché la penna resta in posizione
tappo per tutto il percorso. Se in cima al file c'è `; contatto Z0`, è vecchio.

**Lo spazio in flash è il vincolo che non ci aspettavamo.** Dopo l'installazione
della 4.1.1 con WebUI-2, il browser dei file dichiara **64 kB liberi**:
`index.html.gz` da solo ne occupa 111, e la partizione è quella che è. Quindi
ogni programma deve stare sotto i 64 kB — il collaudo scritto per esteso ne
occupava 69 e **non ci sarebbe entrato**.

Si recupera sfruttando la modalità del G-code, che non è un trucco ma il modo in
cui il linguaggio è fatto: si emette solo quello che cambia (la parola G0/G1
resta valida finché non cambia, una coordinata non ripetuta vuol dire «quell'asse
resta dov'è», e gli zeri in coda si tolgono). Il collaudo passa così da 69.268 a
**44.633 byte**, con lo stesso percorso: verificato ri-eseguendo il file e
confrontando i 2994 stati con quelli del modello, zero differenze.

Con le quote negative il file è risalito a **48.307 byte**: ogni `Z` costa sei
caratteri in più (`Z-21.271` contro `Z0`, `Z-18.326` contro `Z2.945`), per 2976
righe di penna. Resta sotto i 64 kB con 16 di margine, e il controllo è stato
rifatto sul file nuovo: 3025 stati confrontati, zero differenze, nessuna quota
fuori dall'intervallo `(-21.281, 0.010)` dichiarato da FluidNC.

Il disegno occupa 245,5 × 232,5 mm e la corsa percorribile è 251,2 × 236,1:
restano **5,7 mm di margine su X e 3,6 su Y**. Non è molto, quindi l'origine va
messa bene: se il quadrato del punto 2 esce storto o fuori posto, sistemalo
prima di lanciare venti minuti di disegno.

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
| 6 | **Popup 1 — origine macchina.** Premi *Libera i motori*, appoggi **a mano** i due carrelli ai blocchi di riferimento, senza forzarli | la penna è **già alzata** (l'app la alza prima di liberare i motori, altrimenti trascini la punta sul foglio per tutto il posizionamento). Liberando i motori la posizione viene dichiarata non nota, e il DRO lo mostra invece di un numero |
| 7 | **"Homing completato"** | **riattiva i motori, azzera e poi si sposta** — in quest'ordine. `G92 X0 Y0` sul **punto ai blocchi**, che resta lo zero, e subito dopo un `G0` al **punto home** a 5 mm da entrambi: i carrelli non restano appoggiati al riferimento, che è la cosa che non si deve muovere. Lo stato passa a `AZZERATA`, si apre il secondo popup |
| 8 | **Popup 2 — altezza penna.** Col pannello abbassi la Z a piccoli passi finché la punta **tocca il foglio e lascia il segno** | registra quella Z come *quota di appoggio per questa stampa* |
| 9 | **"Altezza penna completato"** | **alza subito la penna** (quel popup finisce per definizione con la punta che tocca), apre il terzo popup |
| 10 | **Popup 3 — inizio foglio.** Col pannello porti la punta sull'angolo in basso a sinistra del foglio. Se vuoi essere sicuro, abbassa un attimo la penna: adesso la quota di appoggio la conosce, quindi un puntino te lo conferma | legge le coordinate correnti (che sono già relative all'origine macchina) e le usa come **posizione del foglio nel piano** |
| 11 | **"Inizio foglio completato"** | **verifica che foglio + disegno stiano dentro il limite di lavoro** con il foglio in quella posizione reale; poi **fissa il foglio sullo schermo** — da quel momento non si trascina più, perché trascinarlo sposterebbe il disegno sulla carta vera senza dirlo — **rigenera il programma** con l'origine del foglio e l'altezza di contatto appena misurate, e solo allora lo consegna. Il lucchetto accanto al piano dice se la posizione è misurata o solo indicativa; premendolo si scarta la misura, e l'app lo scrive |
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
