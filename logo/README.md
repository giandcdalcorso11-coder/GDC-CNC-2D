# Il logo della macchina

Disegnato dall'utente in Illustrator il 1° novembre 2026. Le tre bozze
generate il 27 ottobre non ci sono più: stavano in attesa di una scelta, e la
scelta è questa. (`git show 5c50952` le ha ancora, col generatore e le misure
dell'alfabeto GDC Stuff, se dovessero servire.)

| file | che cos'è | quando si usa |
|---|---|---|
| `cnc2d.ai` | il sorgente di Illustrator | per modificarlo |
| `cnc2d-illustrator.svg` | l'esportazione, intatta | **per plottarlo** |
| `cnc2d.svg` | quella per lo schermo | pagina, favicon, qualunque fondo |
| `pulisci.py` | fa il secondo dal primo | dopo ogni riesportazione |

## Perché due SVG e non uno

L'esportazione di Illustrator disegna i **controformi** — il 2 e la D — con
due paths **bianchi** sopra a quelli neri. Su carta bianca si legge giusto, e
infatti è così che è stato disegnato. Ma il bianco è inchiostro come un altro:

- su un fondo grigio compaiono due macchie bianche dove dovrebbero esserci
  due buchi;
- su fondo nero del logo resta soltanto **«2 D»** in bianco, e il resto
  sparisce;
- nello SLICER, che è scuro, succede la seconda cosa.

`pulisci.py` trasforma quei due paths in una **maschera**, cioè in buchi veri.
Su bianco non cambia un pixel; su tutto il resto comincia a funzionare. Già
che c'è, taglia il `viewBox` sul disegno (l'esportazione è un A4 con 370
punti di margine) e mette `fill="currentColor"`, così il colore lo decide chi
lo usa — nero su carta, chiaro sul pannello scuro.

```
python3 pulisci.py cnc2d-illustrator.svg cnc2d.svg
```

**Per plottare si usa l'esportazione intatta.** Su un plotter il bianco non
esiste: la penna segue i contorni, e i contorni del 2 e della D sono bordi
veri del disegno, da disegnare come gli altri. Una maschera, lì, è una
complicazione che l'importatore dello SLICER non è tenuto a capire.

## Le misure, prese dal file

Servono per i confronti futuri: se il logo viene ridisegnato, questi numeri
dicono che cosa è cambiato.

| | unità del file | nota |
|---|---|---|
| ingombro | 472,19 × 158,44 | rapporto **2,98 : 1** |
| altezza della N | 158,44 | da 195,77 a 354,21 |
| altezza delle C | 151,41 | da 199,30 a 350,71 |
| altezza del 2 | 122,90 | |
| altezza della D | 120,40 | |
| asta della N | 38,1 | misurata sul reso |
| spina della C | 43,7 | **+15%** sull'asta della N |
| pieno della D | 41,6 | |
| barretta della penna | 81,3 × 19,6 | il dettaglio più piccolo |

Le due C sono **disegni diversi**, non una specchiata dell'altra: la prima è
chiusa e tiene dentro la penna, l'ultima è **spezzata** come quella del logo
GDC Stuff ed è **rovesciata**, con la bocca verso la D, che ci si annida
dentro.
