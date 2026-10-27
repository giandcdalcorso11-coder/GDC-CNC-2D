# Il logo della macchina

Tre varianti di **CNC 2D**, costruite sull'alfabeto del logo *GDC Stuff* invece
che disegnate accanto a lui. Il generatore è `cnc2d.js`; gli SVG sono il suo
prodotto e non si modificano a mano.

```
node cnc2d.js .        ->  cnc2d-a-riga.svg, cnc2d-b-monogramma.svg, cnc2d-c-chiusura.svg
```

## Da dove vengono le lettere

I contorni sono quelli veri di **Jost Bold**, il font che `gdc master.svg`
dichiara, letti dal TTF e non ridisegnati a occhio. Le tre lettere grandi del
logo GDC però non sono Jost puro: sono tre segni disegnati uno per uno, e lo si
vede misurandoli — **la G ha l'asta a 0,257 dell'altezza maiuscola, la C a
0,181**. Non è un alfabeto coerente.

Quello che li tiene insieme non è il peso. Sono **tre modi di interrompere la
forma**, e quelli si possono portare su altre lettere:

| | Che cos'è | Regola di Gestalt |
|---|---|---|
| **la C è spezzata** | fra i due archi c'è un vuoto di 64,8 su 196,6 — un terzo della lettera — e si legge «C» lo stesso | **chiusura**: l'occhio completa un contorno che non c'è |
| **la D è piena** | nessun occhiello, un mezzo ellisse | **figura-sfondo** portata all'estremo: la lettera ridotta alla sua ombra |
| **la D è più bassa** | 0,751 dell'altezza maiuscola, centrata in verticale | rompe l'allineamento apposta, così il segno non si legge come una lettera qualsiasi |

Il mark nuovo usa gli stessi tre modi sulle lettere di CNC 2D. Ogni costante del
generatore è una di queste misure, non un numero scelto.

## Le tre varianti

**A — la riga.** `CNC 2D` per esteso, le due C spezzate, la D piena e più bassa.
Lo stacco fra parola e numero è il doppio dell'avvicinamento fra le lettere:
**prossimità**, ed è quello che fa leggere «CNC» e «2D» come due cose invece che
cinque segni in fila. È la versione da usare quando il logo deve essere **letto**
— sulla macchina, in fondo a un foglio, in una riga di testo. Regge fino a 16 px
di altezza.

**B — il monogramma.** Quattro posti per cinque segni, come nello schizzo: il 2 e
la N si fondono, perché la barra di base del 2 finisce dove comincia l'asta
sinistra della N e le due si sovrappongono per tutto lo spessore dell'asta. Non
si legge da sinistra a destra: si riconosce.
**È la mia lettura dello schizzo, e va confermata** — se la fusione che avevi in
mente era un'altra, cambia una riga del generatore.

**C — la chiusura.** `CNC` grande, e `2D` dentro al vuoto della C finale. È il
modo del logo GDC portato fino in fondo: lì il vuoto in mezzo alla C è un difetto
che l'occhio corregge, qui lo stesso vuoto diventa **il posto dove sta il resto
del nome**. La lettera si legge comunque, e il mark acquista un dentro e un fuori.
A misura piccola il «2D» si chiude in una macchia ma «CNC» sopravvive: va usata
grande.

## Che cosa manca

- **la versione da plottare.** Qui le C spezzate usano `clipPath`, che per lo
  schermo va bene e per la penna no: il ritaglio va cotto nella geometria. Si fa
  con gli strumenti che ci sono già — l'importatore legge i tracciati e
  `SvgImport.ritaglia` taglia per davvero.
- **il colore.** Adesso eredita il verde del logo GDC (`#497B58`). Se la macchina
  vuole un colore suo, si decide quando si decide il box.
