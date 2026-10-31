# GDC CNC 2D SLICER

L'interfaccia di controllo e preparazione del disegno. Non sostituisce la WebUI
di FluidNC: la affianca, occupandosi di tutto ciò che sta *prima* del G-code —
il foglio, il disegno, l'anteprima del percorso — e usando FluidNC per eseguirlo.

Stato attuale: **funzionante dall'SVG al G-code**. Si importa un file, lo si
posiziona sul foglio, si preparano il percorso ottimizzato e il G-code con la
stima del tempo. Manca il collegamento alla macchina e la taratura della penna.
Le parti non costruite sono segnalate nell'interfaccia stessa con una nota in
corsivo, per non scambiare un segnaposto per una funzione rotta.

## Vincoli che hanno determinato la forma del codice

**Niente framework, niente librerie, niente processo di build.** La pagina
dovrà essere servita dalla memoria dell'ESP32, dove lo spazio è di qualche
centinaio di kilobyte e non c'è internet garantito. Tutto ciò che serve è nella
cartella, e si apre com'è.

**Script classici, non moduli ES.** Un modulo ES caricato da `file://` viene
bloccato dal browser, quindi la pagina non si potrebbe nemmeno guardare senza
un server. Con gli script normali si apre `index.html` con un doppio clic.

**L'interfaccia dovrà essere servita dall'ESP32 per funzionare davvero.**
FluidNC espone il suo HTTP senza intestazioni CORS: una pagina caricata da un
altro dominio invia le richieste ma il browser le rifiuta. Finché non è
caricata sulla macchina, si lavora in modalità finta.

## Modalità finta

Attiva per impostazione predefinita. L'interfaccia simula le risposte della
macchina: nessuna richiesta esce dal browser, le coordinate si aggiornano, il
log si riempie. Serve a poter lavorare sull'interfaccia senza accendere nulla,
che è la maggior parte del tempo.

Si disattiva dalla tab Impostazioni.

## I file

| File | Contenuto |
|---|---|
| `index.html` | struttura della pagina |
| `css/base.css` | variabili di colore, reset, tipografia |
| `css/layout.css` | barra, tab, le tre colonne |
| `css/components.css` | schede, pulsanti, spie, foglio, cursore, log |
| `js/state.js` | stato centrale e notifiche fra moduli |
| `js/api.js` | comunicazione con FluidNC e modalità finta |
| `js/logview.js` | la tab Log |
| `js/paper.js` | piano, foglio, percorso sul piano |
| `js/svgimport.js` | lettura dell'SVG, appiattimento delle curve, diradamento |
| `js/optimize.js` | saldatura, doppioni, ordine e verso, stima del tempo |
| `js/gcode.js` | generazione del G-code |
| `js/artwork.js` | il disegno importato e la preparazione della stampa |
| `js/sample.js` | disegno di esempio (generato, escluso dalla build per l'ESP32) |
| `js/preview.js` | il cursore verticale che fa scorrere la penna |
| `js/jog.js` | movimento manuale, origine, penna |
| `js/settings.js` | la tab Impostazioni |
| `js/app.js` | avvio, tab, barra di stato |

## Due dettagli che è facile sbagliare

**L'area di lavoro è fissa, il foglio ci sta dentro.** Il riquadro centrale è
la corsa degli assi e non cambia quando si cambia formato di carta: il foglio è
un rettangolo disegnato al suo interno, nella posizione in cui sta davvero sulla
macchina. Così si vede quanta corsa avanza attorno, che è l'informazione che
dice se un disegno ci sta o manda il carrello in battuta. Quando il foglio esce
dall'area, il suo bordo diventa rosso tratteggiato.

L'SVG riempie tutto lo spazio disponibile e la viewBox scala il piano perché ci
stia dentro, centrato. Nessuna dimensione viene decisa da JavaScript e nessun
lato si contende lo spazio con l'altro: era la causa del foglio che si
deformava cambiando una misura.

**Il disegno è in coordinate del foglio, non del piano.** `State.data.art`
tiene i segmenti rispetto all'angolo in basso a sinistra del foglio; la
posizione sul piano si somma solo in `rebuildPath`. Così trascinare il foglio
porta con sé il disegno per costruzione, senza ricalcolarlo, e un SVG caricato
resta valido anche se poi il foglio viene spostato altrove.

**Il trascinamento usa la matrice del gruppo ribaltato.**
`flip.getScreenCTM().inverse()` porta dai pixel dello schermo ai millimetri
della macchina in un colpo solo, ribaltamento dell'asse Y compreso, e resta
corretta a qualsiasi dimensione della finestra. Rifare quei conti a mano
significherebbe sbagliarli al primo ridimensionamento.

**L'asse Y è ribaltato.** In SVG la Y cresce verso il basso, sulla macchina
cresce verso l'alto. Il gruppo `#flip` applica `translate(0,H) scale(1,-1)`
così le coordinate dentro l'SVG sono quelle della macchina, in millimetri.
Senza quel ribaltamento ogni disegno uscirebbe specchiato, ed è un errore che
si scopre tardi e a foglio rovinato.

**Gli spessori di tratto sono in millimetri.** Dentro l'SVG l'unità è il
millimetro per via della viewBox: uno `stroke-width: 1` sarebbe un tratto da
un millimetro, non da un pixel, e cambierebbe aspetto a ogni formato di foglio.

**Cambiare foglio non riadatta il disegno: lo sposta.** I rettangoli dei
livelli sono in millimetri dal bordo del foglio, e un millimetro vale un
millimetro anche su un foglio di un'altra misura. Quando il formato cambia,
tutte le collocazioni si spostano della stessa quantità — metà della
differenza fra i due fogli, cioè il foglio cresce o si stringe attorno al
proprio centro — e taglie, proporzioni, rotazioni, ritagli e distanze
reciproche restano quelle di prima. Fino al 31 ottobre qui si buttavano via
rettangolo e ritaglio di *ogni* livello e si riadattava ciascuno al foglio
nuovo per conto suo: due livelli larghi diversi tornavano larghi uguali, ogni
pezzo tornava in mezzo al foglio, e il disegno si smontava. Adattare al foglio
nuovo è un gesto, e si fa dopo: col campo Scala o col riquadro.

**La scala di più livelli scala il gruppo, non ognuno per conto suo.** Con la
spunta «Scala i livelli scelti insieme» il numero scritto nel campo vale per
tutti: si scala il rettangolo che li contiene, e ciascuno ci resta dentro nella
stessa frazione di prima. Scalare ogni livello della stessa percentuale ma
attorno al proprio centro — la cosa che sembra uguale — li allontanerebbe l'uno
dall'altro. La rotazione resta di un livello solo anche con la spunta: ruotare
il gruppo vorrebbe dire ruotare ogni disegno attorno a un centro che non è il
suo.

**Un livello nuovo nasce con la mappa di quello accanto.** «+ livello nuovo»,
nella colonna dell'editor, crea un livello vuoto che copia rettangolo,
ingombro e rotazione di quello che si sta modificando. Senza quella mappa
l'editor non avrebbe coordinate in cui portare gli altri livelli da disegnare
dietro, e la tela resterebbe vuota proprio mentre si guarda dove incollare.
L'ingombro copiato non va corretto dopo: `refit()` salta i livelli vuoti e non
lo tocca, e al primo contenuto `rigenera()` lo usa come ancora.

## L'importazione e l'ottimizzazione

**L'appiattimento delle curve lo fa il browser.** Ogni forma vettoriale espone
`getTotalLength` e `getPointAtLength`: si campiona per lunghezza d'arco e si
ottengono punti equidistanti lungo la curva, senza riscrivere a mano la
matematica delle Bézier.

Quel campionamento regala anche il riconoscimento dei sotto-tracciati. Due
campioni consecutivi non possono distare più del passo scelto, quindi un salto
più lungo è per forza uno stacco di penna dentro lo stesso elemento — il foro
di una "o", il contorno interno di una "D". Senza quel controllo comparirebbe
una riga che attraversa la lettera.

**Il diradamento viene dopo la scalatura**, mai prima: una tolleranza di un
decimo di millimetro ha senso sul foglio, non nelle unità arbitrarie del file,
che possono valere un millimetro come un metro.

**Il criterio dell'ottimizzazione è il tempo, non la distanza.** Ogni alzata di
penna costa circa mezzo secondo fra il movimento del servo e l'assestamento;
uno spostamento di cinquanta millimetri a 2000 mm/min ne costa uno e mezzo.
Eliminare un'alzata vale quindi più che accorciare uno spostamento, ed è il
motivo per cui la saldatura dei tratti contigui viene prima del riordino.

Il riordino è un vicino-più-prossimo con due libertà in più rispetto alla
versione scolastica: un tratto aperto si può percorrere da entrambi i capi, e
un contorno chiuso si può cominciare da uno qualsiasi dei suoi punti. La
seconda conta molto su un logo, fatto quasi solo di contorni chiusi: senza di
essa la penna raggiungerebbe sempre il punto in cui il disegnatore ha
cominciato la forma, che non ha relazione con dove si trova adesso.

**Le forme piene diventano contorni.** Una penna non riempie. Il riempimento a
tratteggio si potrà aggiungere più avanti.

## Cosa manca

- Invio del programma alla macchina e avanzamento in tempo reale
- Conversione da fotografia a tracciato vettoriale
- Riempimento a tratteggio delle forme piene
- Calibrazione dell'area dai due angoli del foglio
- Comandi della penna, dopo la taratura del servo
- Caricamento della pagina nella memoria dell'ESP32
