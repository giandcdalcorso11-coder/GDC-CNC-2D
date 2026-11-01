# Il logo della macchina

Disegnato dall'utente in Illustrator il 1° novembre 2026, e rivisto lo stesso
giorno: le C alzate fino all'altezza della N, gli spazi fra le lettere
pareggiati, la D più alta. Le tre bozze generate il 27 ottobre non ci sono
più — stavano in attesa di una scelta, e la scelta è questa. (`git show
5c50952` le ha ancora, col generatore e le misure dell'alfabeto GDC Stuff.)

| file | che cos'è | quando si usa |
|---|---|---|
| `cnc2d.svg` | **il logo** | pagina, favicon, stampa, plotter: qualunque cosa |
| `cnc2d-illustrator.svg` | l'esportazione intatta | per confronto, e per rifare `cnc2d.svg` |
| `cnc2d.ai` | il sorgente di Illustrator | **è della prima versione**: da sostituire |
| `pulisci.py` | fa il primo dal secondo | dopo ogni riesportazione |

```
python3 pulisci.py cnc2d-illustrator.svg cnc2d.svg 56.69 195.75 487.03 158.49
```

I quattro numeri sono il riquadro del disegno, misurato col browser
(`getBBox()`), perché l'esportazione è grande quanto il foglio di lavoro: un
A4 con 370 punti di margine vuoto.

## Che cosa fa `pulisci.py`, e perché serve

**1. I controformi diventano buchi.** Illustrator disegna il 2 e la D con
path **bianchi** sopra a quelli neri. Su carta bianca si legge giusto, ma il
bianco è inchiostro come un altro: su un fondo grigio compaiono macchie
bianche dove dovrebbero esserci buchi, e su fondo nero del logo resta solo
«2 D». Lo SLICER è scuro, quindi era il nostro caso.

Non basta una maschera sola: conta **l'ordine**. Un nero disegnato DOPO un
bianco ci passa sopra — è così che è fatto il pieno della D — e bucarlo con
quel bianco lo cancellerebbe. Quindi i pezzi si dividono in gruppi fra un
bianco e l'altro, e ogni gruppo viene bucato soltanto dai bianchi che gli
stanno **sopra**.

**2. Si butta quello che non si vede.** Un path `fill:none` e una polilinea
di area zero (tre punti sulla stessa retta), rimasti dalla lavorazione.
Sullo schermo non cambiano niente, ma **un plotter li disegnerebbe tutti e
due**: una riga dritta in mezzo al pennino.

**3. Si cuciono le fessure.** Due pezzi che si toccano esattamente, invece di
sovrapporsi, lasciano una riga chiara dove il disegno dovrebbe essere pieno:
nessuno dei due bordi arriva a coprire tutto il pixel. In Illustrator non si
vede — lavora in vettoriale, le fessure di larghezza zero lì non esistono —
ma si vede su qualunque schermo. La cura, senza operazioni booleane, è un
**contorno sottilissimo dello stesso colore** su ogni pezzo: ogni forma
cresce di mezza larghezza di contorno e i due bordi si sormontano.

Con `CUCITURA = 0,3` (lo 0,19% dell'altezza del logo), misurato sul reso a
1600 px:

| | nell'esportazione | dopo |
|---|---|---|
| la cucitura sul bianco del controforma | 222/255 — **13%** di contrasto | 252/255 — **1,2%** |
| la cucitura dentro al nero del pennino | 40/255 — **16%** | 5/255 — **2%** |
| su fondo scuro | — | 22 contro 20 — **0,8%** |

Più grossa non conviene: a 2,0 la cucitura si mangia lo **stacco di 2,17
unità fra il pennino e la sua barra**, che è voluto.

## Le misure, prese dal file

Servono per i confronti futuri: se il logo viene ridisegnato, questi numeri
dicono che cosa è cambiato.

| | prima versione | **adesso** |
|---|---|---|
| ingombro | 472,19 × 158,44 (2,98:1) | **487,03 × 158,49 (3,07:1)** |
| altezza della N | 158,44 | 158,44 |
| altezza delle C | 151,41 (−4,4%) | **158,49 (pari)** |
| altezza della D | 120,40 | **125,91** |
| spazio C–N / N–C | 38,6 / 47,4 (23% di scarto) | **43,7 / 45,5 (4%)** |
| asta della N | 38,1 | 38,3 |
| spina della C | 43,7 (+15%) | 44,6 (+16%) |
| stacco pennino–barra | — | 2,17 |

Le due C sono **disegni diversi**, non una specchiata dell'altra: la prima è
chiusa e tiene dentro il pennino, l'ultima è **spezzata** come quella del
logo GDC Stuff ed è **rovesciata**, con la bocca verso la D, che ci si annida
dentro.

## Quello che manca

- **La versione quadrata**, per la favicon e per i profili: sotto i ~120 px
  di larghezza il marchio lungo diventa una macchia, e il pennino muore già
  a 200. Va **disegnata**, non rimpicciolita: la prima C col pennino dentro,
  in un quadrato.
- **La firma del filone** («by GDC Stuff» o simile), da decidere.
- **Il sorgente `.ai` aggiornato**: quello in repository è della prima
  versione.
