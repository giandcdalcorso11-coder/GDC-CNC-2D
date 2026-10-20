# Il disegno di collaudo

Una stampa sola, su quasi tutta l'area, da cui si tirano fuori **otto numeri**
diversi. Si genera con `webui/tools/test-macchina.js`, e si genera **dopo** aver
montato il modulo penna: gli servono la quota di contatto e l'alzata vere.

```
node webui/tools/test-macchina.js --svg prova.svg
node webui/tools/test-macchina.js --gcode prova.gcode --contatto <Z> --alzata <mm>
```

Campo 246 × 233 mm, cioè l'area percorribile meno un margine. Serve un foglio
di misura libera — due A4 accostati, o un foglio da plotter tagliato.

Strumenti: **riga d'acciaio da 300**, **calibro**, e gli occhi.

---

## Cosa misura ogni pezzo, e come si legge

### 1. La cornice — l'area è tutta raggiungibile?

Il giro completo del campo. Se un lato non si chiude o la macchina va in
battuta, le corse nel profilo sono sbagliate. Guarda anche **lo spessore del
tratto sui quattro lati**: un lato più marcato è un lato dove il piano è più
alto, ed è la prima occhiata al livellamento.

### 2. I due righelli — la SCALA, un asse per volta

Tacche ogni 10 mm su 200, più alte ogni 50. **È la misura che tara i mm per
giro ingranaggio.**

Appoggia la riga d'acciaio sopra, allinea lo zero, e leggi dove cade la tacca
dei 200. Se cade a 199,4 il rapporto va corretto di `199,4/200`, e si inserisce
nella tab Impostazioni → *Taratura disegnando*.

Guarda anche **come** sbaglia: un errore che cresce uniforme è il rapporto; uno
scatto fra due tacche vicine è gioco o passi persi, ed è un problema diverso.

### 3. Il quadrato da 150 con le diagonali — l'ORTOGONALITÀ

Misura le due diagonali fra le crocette d'angolo, col calibro o con la riga.

```
errore di squadra (radianti) = (diagonale1 − diagonale2) / (1,414 × 150)
```

Mezzo grado di fuori squadra fa 1,3 mm sull'angolo di un A5 — più di tutti gli
altri errori messi insieme, e si compensa via software una volta misurato.

### 4. I tre cerchi — scala e gioco, a colpo d'occhio

- **Esce un'ellisse** → i mm per giro dei due assi non coincidono, e il verso
  dell'ellisse dice quale asse è lungo.
- **Scalini nei quattro punti** dove un asse inverte il moto → è il gioco.
- Tre raggi perché un errore di scala **cresce col raggio** e un gioco no: se i
  tre scalini sono uguali è gioco, se crescono è scala.

### 5. I nove nodi a gradini — la MAPPA DEL LIVELLAMENTO

Quattro trattini affiancati per nodo, ognuno **0,30 mm più in alto** del
precedente — un gradino per volta, perché 0,30 è la banda morta del servo e più
fine di così si misurerebbe il rumore.

**Conta i trattini che hanno segnato:**

| trattini | vuol dire |
|---|---|
| 0 | piano **più basso** del contatto: lì la penna non tocca |
| 1 | piano alla quota giusta |
| 2 | piano alto di ~0,3 mm |
| 3 | piano alto di ~0,6 mm |
| 4 | piano alto di ~0,9 mm o più |

Nove punti — quattro angoli, quattro lati, centro — perché tre bastano a
definire un piano, ma servono di più per vedere una **svergolatura**, che è
diversa da un'inclinazione e non si corregge allo stesso modo.

**Perché conta tanto su questa macchina:** il modulo penna non ha molla, la
penna in Z è rigida. Il fuori-piano non si assorbe — dove il piano scende la
penna non tocca, dove sale preme.

### 6. Il doppio pettine — il GIOCO in millimetri

La stessa serie di tacche disegnata due volte: la fila sopra percorrendo l'asse
in avanti, quella sotto tornando indietro. **Lo scarto orizzontale fra una
tacca e la sua gemella è il gioco.** Si misura col calibro. Se le due file si
allineano, il gioco sta sotto il decimo. La previsione dal CAD è **0,30 mm**.

### 7. Gli stacchi — la PAUSA del servo e l'alzata

Dodici trattini separati da spazi.

- **Segni negli spazi** → la penna non fa in tempo ad alzarsi: alza la pausa, o
  l'alzata non basta a scavalcare il fuori-piano.
- **Un pallino all'inizio di ogni trattino** → la penna si appoggia e aspetta
  ferma: la pausa è più lunga del necessario.

### 8. La scala dei caratteri — il dettaglio minimo

La stessa scritta a 5, 4, 3, 2,5 e 2 mm. Il più piccolo che resta leggibile è
la risoluzione utile della macchina **con quella penna**. A 2 mm, con una punta
da 0,4, sono cinque larghezze di tratto: lì sotto non è la macchina a non
farcela, è il pennarello.

### 9. Le due rette lunghe — la RETTILINEITÀ

Una per asse, lontane dai bordi. Riga d'acciaio sopra e si guarda controluce.
Una linea che s'incurva non è errore di scala: è la trave che flette o il
portale che imbarda mentre avanza. I due si distinguono perché **il primo piega
una linea sola, il secondo le piega tutte nello stesso verso.**

---

## L'ordine in cui si leggono

Prima **il livellamento** (5) e **gli stacchi** (7): se il piano è storto o la
penna striscia, tutto il resto è misurato male.

Poi **la scala** (2), perché corregge i numeri del profilo e cambia ogni misura
successiva.

Poi **ortogonalità** (3), **gioco** (6) e **rettilineità** (9), che sono i
difetti residui con cui si convive o che si compensano.

I **cerchi** (4) e i **caratteri** (8) si guardano per ultimi: confermano a
occhio quello che i numeri hanno già detto.
