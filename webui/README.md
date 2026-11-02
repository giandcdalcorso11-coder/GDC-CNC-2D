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

## Il marchio nell'intestazione

Il logo sta al posto delle parole «CNC 2D», che è quello che il logo dice:
resta «GDC» davanti e «SLICER» dietro, così la riga si legge per intero. È
inline, prende il colore dal testo (`fill="currentColor"`) e quindi segue il
tema senza una seconda copia da tenere d'accordo.

**La sorgente è una sola e sta in `logo/cnc2d.svg`.** Qui dentro ce n'è una
copia, perché la pagina è un file solo e un `<img src>` verso l'esterno non
sopravviverebbe alla costruzione — ma una copia fatta a mano prima o poi resta
indietro. `tools/logo.py` la rifà in un secondo, e con `--controlla` dice solo
se è allineata. Quando il logo cambia, si lancia quello.

**Una cosa da sapere: a misura di intestazione il marchio non si legge come
lettere.** Gli incastri che lo rendono interessante a venti millimetri a venti
PIXEL diventano una macchia. Sta a 26 px perché la barra è alta 52 e quello è
il massimo che ci sta; sotto i 20 non si riconosce più. È la **versione
quadrata** che manca, quella che lo Step 7 del documento di sessione chiede
già: un marchio piccolo si disegna, non si rimpicciolisce.

### Il marchio dentro al disegno

Il pulsante **«Inserisci il logo CNC 2D»** sta accanto a quello del logo GDC
Stuff, sotto ai livelli, e fa la stessa cosa del suo vicino: il marchio entra
come **livello nuovo**, importato come un file qualsiasi. Stessa strada, stesso
gesto, nessuna regola in più da ricordare.

Il disegno viene dall'**SVG che sta già nella pagina**, quello
dell'intestazione: una copia sola, e quando il logo cambia cambiano insieme il
marchio in alto e quello che finisce sul foglio.

**Prima di darlo all'importatore si riduce a un colore solo.** Sullo schermo il
marchio è fatto di lettere piene con dentro i contrografici **bianchi**,
ritagliati con una maschera, più un gruppo con un bordo sottile — la cucitura
che chiude le fessure fra forme accostate. Sono tre colori, e l'importatore
divide per colore: dato così, il marchio arrivava spezzato in **due livelli**, e
sul foglio si vedeva un «2 D» che galleggiava senza il resto. Ma quei colori non
sono penne diverse: sono il modo in cui si ritaglia un buco in un'area piena. Su
carta una penna sola traccia il contorno delle lettere **e** quello dei buchi, e
il bianco è la carta.

**E l'importatore ha imparato una cosa che gli serviva comunque.** Quello che
sta in un **magazzino** — `<defs>`, `<symbol>`, `<marker>`, `<pattern>`, un
gradiente — non è nel disegno: si vede solo dove qualcos'altro lo richiama, e
disegnarlo dov'è scritto vuol dire mettere sulla carta roba che nel file non
c'è. Ma **una maschera non è un magazzino**: il suo contenuto non è inchiostro,
però dice *dove* il disegno si vede, e i suoi contorni sono bordi del risultato
finale — che per una penna è esattamente la cosa da disegnare. Decide il più
vicino dei due, così una maschera dentro a `<defs>` (cioè quasi tutte) resta
una maschera. Il rettangolo di fondo della maschera lo scartava già la regola
degli sfondi, che butta via quello che è grande quanto il foglio.

## I due strumenti che tagliano, e quello che ribalta

**Il selettore specifico (il lazo).** Si cerchia a mano libera e si prende
**solo quello che resta dentro**; dove una spezzata esce dal cerchio, **la si
taglia sul bordo**. È il taglio a renderlo diverso da tutto il resto, e senza
quello non servirebbe: su un disegno importato una «linea» non esiste — una
campitura a onde è **un** tracciato con decine di migliaia di nodi — e portarne
via un pezzo con Scegli e Ctrl+X vuol dire cliccare tratto per tratto per
mezz'ora. Il rettangolo di selezione non aiuta: prende le **forme** che tocca,
cioè tutta la campitura.

Il taglio è sul bordo **vero**, non al nodo più vicino: su un tratto dritto è
l'intersezione esatta, su una curva una bisezione sul parametro, e le due metà
della curva si ricavano con de Casteljau, così la curva non si storce proprio
dove la si taglia. Misurato: i nodi nuovi cadono a **tre centesimi di micron**
dal bordo, e una curva tagliata si discosta dall'originale al massimo di
**7 micron**, che è un cinquantesimo della punta di una penna.

**Il lazo non cambia il disegno**, cambia solo dove stanno i nodi — e da questo
viene la cosa più importante sulle prestazioni: le polilinee già calcolate
restano valide, quindi `Artwork.rigenera()` si salta. Su sessantamila tratti il
gesto costava **1714 ms**, di cui **1556 di sola rigenerazione**; la geometria
vera (incroci, tagli, de Casteljau) è **126 ms**. Saltandola, 181. Si pagava
dieci volte tutto il resto per rifare un calcolo dal risultato identico.

E i tratti scelti si disegnano in **un `path` solo**, con `C` dove c'è una
curva: prima erano una `polyline` per tratto con venticinque campioni
ciascuna, che per dieci tratti andava bene e per duemila diventava un quarto di
secondo **a ogni ridisegno**, cioè anche solo spostando lo sguardo.

**Lo specchio.** Ribalta quello che è scelto attorno alla riga di mezzo della
selezione, così il disegno si gira senza spostarsi. Non è una rotazione di
mezzo giro, ed è il motivo per cui serve: una lettera ruotata resta leggibile
al contrario, una lettera **ribaltata** è l'immagine allo specchio — le due
cose coincidono solo per le figure simmetriche. Il bottoncino tondo accanto
sceglie l'asse, e la freccia mostra il **verso del ribaltamento** e non la riga
dello specchio: «destra-sinistra» si capisce, «asse verticale» si deve
tradurre ogni volta.

Un testo ribaltato **smette di essere un testo**: la forma `testo` tiene la
parola e l'altezza, e da quelle le lettere si ricostruiscono dritte ogni volta,
quindi non c'è posto dove scrivere «ma rovesciata». Lo specchio lo trasforma in
tracciati, una volta sola e dicendolo nel registro.

Il collaudo è `tools/prova-editor.js` (`node webui/tools/prova-editor.js`): gira
sulla pagina costruita, in un browser vero, e la cosa che controlla davvero non
è «ha selezionato qualcosa» ma **che tagliando, il disegno non cambi**. Le
soglie di tempo sono strette apposta: senza il salto della rigenerazione il lazo
torna a 1,8 secondi, e una soglia larga lascerebbe rientrare quel secondo e
mezzo senza che nessuno se ne accorga.

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
