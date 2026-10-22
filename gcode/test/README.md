# G-code di prova

Due file minimi per verificare il moto prima che esista la struttura, con i
motori appoggiati sul banco e un pezzetto di nastro sull'albero come indice.

| File | Cosa verifica |
|---|---|
| `quadrato-40mm.gcode` | movimento su un asse alla volta, e l'inversione di direzione |
| `cerchio-r20.gcode` | interpolazione: i due assi che si muovono insieme |
| `quadrato-e-cerchio-penna.gcode` | i due insieme, con i movimenti del servo |

## Come eseguirli

Senza scheda SD, il modo più rapido è incollare le righe nel campo comandi
della WebUI una alla volta. I file si possono anche caricare nella memoria
interna dell'ESP32 dalla tab FluidNC e mandarli in esecuzione da lì.

Attenzione al campo comandi della WebUI: incollando con Ctrl+V alcune
versioni del browser aggiungono una `v` in fondo alla riga, e FluidNC
risponde `error:2 Bad GCode number format`. Controllare il campo prima di
inviare.

## Perché 40 mm

Con `steps_per_mm: 80` e microstep 1/16, 40 mm corrispondono a 3200
microscatti, cioè esattamente un giro dell'albero. Il numero è scelto per
questo: rende il test verificabile a occhio senza strumenti. Se un lato del
quadrato producesse sedici giri invece di uno, i ponticelli MS1/MS2/MS3 non
starebbero facendo effetto e il driver sarebbe rimasto a passo intero.

Il valore 80 resta comunque un segnaposto ereditato da un'ipotesi di
trasmissione a cinghia. Con cremagliera e pignone andrà ricalcolato e poi
tarato sulla macchina, e a quel punto i 40 mm non saranno più un giro esatto:
questi file restano validi come prova di movimento, non come riferimento
dimensionale.

**Aggiornamento, a trasmissione decisa.** Con pignone modulo 1,5 e 20 denti un
giro vale `pi * m * z = 94,2478 mm`, quindi a 1/16 microstep servono **33,953
passi/mm** e i 40 mm del quadrato sono 1358 microscatti, cioè 0,42 giri. La
verifica "un lato = un giro" non vale più: per controllare che i ponticelli
MS1/MS2/MS3 stiano facendo effetto si usa il pulsante "1 giro" della dashboard,
che calcola gli impulsi dai microstep impostati.

## I comandi della penna

I primi due file non toccano l'asse Z, e restano utili per provare gli assi
quando il servo non è collegato.

`quadrato-e-cerchio-penna.gcode` usa **Z-3 per la penna alzata e Z-7 per
quella abbassata**. Sono due valori al centro della corsa, scelti perché
sicuri: gli estremi corrispondono agli impulsi da 1000 e 2000 µs, dove un
SG90 trova spesso la propria battuta meccanica e resta a spingere contro se
stesso. Diventeranno valori veri quando esisterà il portapenna e si potrà
vedere dove la punta tocca il foglio.

Se la penna si muove al contrario, si scambiano i due numeri — oppure, in
modo definitivo, i due valori di impulso nella configurazione.

**Sono file vecchi, e quei due numeri sono casuali.** Dal 2026-10-22 le quote
vere della macchina sono `Z0` per la posizione tappo, `Z-18.326` per la penna
alzata e `Z-21.271` per la punta sul foglio, e stanno nel profilo del SLICER.
Questi file restano solo come prova degli assi: `Z-3` e `Z-7` cadono dentro la
corsa, quindi il servo si muove, ma non corrispondono a niente di misurato.

Il `G92` azzera **solo X e Y**. Azzerare anche Z sposterebbe il riferimento
della penna su una posizione arbitraria, e da lì in poi ogni quota sarebbe
riferita a un punto che nessuno ha scelto.

Le pause `G4 P0.3` danno al servo il tempo di arrivare e di smettere di
oscillare prima che il carrello riparta. Senza, il primo tratto viene
disegnato mentre la penna sta ancora scendendo.
