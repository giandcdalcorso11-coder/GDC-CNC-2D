# Il disegno di collaudo

Una stampa sola, su quasi tutta l'area, da cui si tirano fuori **undici cose**
diverse. Ogni prova sta in un riquadro numerato: il numero sul foglio rimanda
al paragrafo qui sotto.

```
node webui/tools/test-macchina.js --svg prova.svg
node webui/tools/test-macchina.js --gcode prova.gcode --contatto <Z> --alzata <mm>
```

**Si genera dopo aver montato il modulo penna**, quando la quota di contatto e
l'alzata sono numeri misurati. Campo **246 × 233 mm** — serve un foglio
tagliato su misura.

Strumenti: **riga d'acciaio da 300**, **calibro**, una **lente** se ce l'hai.

---

## L'ordine in cui si legge

Non è l'ordine dei numeri. Alcune prove invalidano le altre se vanno male:

1. **Prima la 11 (livello) e la 7 (stacchi).** Se il piano è storto o la penna
   striscia, tutto il resto è misurato male e non vale la pena guardarlo.
2. **Poi la 2 e la 3 (scala).** Correggono i numeri del profilo, e ogni misura
   successiva cambia di conseguenza.
3. **Poi 4, 6, 9 (squadro, gioco, ripetibilità).** Sono i difetti residui: o ci
   si convive, o si compensano via software.
4. **Per ultime 5, 8, 10 (cerchi, caratteri, velocità).** Confermano a occhio
   quello che i numeri hanno già detto, e dicono dove stanno i limiti d'uso.

---

## 1 — La cornice

**Cosa guardi:** il giro completo del campo.

**Cosa ti dice:** che tutta l'area è raggiungibile. Se un lato non si chiude o
la macchina va in battuta, le corse nel profilo sono sbagliate.

**Seconda lettura:** confronta **lo spessore del tratto sui quattro lati**. Un
lato più marcato è un lato dove il piano è più alto. È la prima occhiata al
livellamento, e anticipa la prova 11.

## 2 e 3 — Scala X e scala Y (e rettilineità)

**Cosa misuri:** appoggia la riga d'acciaio sopra il righello, allinea lo zero
con la prima tacca, e **leggi dove cade la tacca dei 200** (dei 190 sull'asse Y).

**Cosa ti dice:** è **la misura che tara i mm per giro ingranaggio**. Se la
tacca dei 200 cade a 199,4, il rapporto va moltiplicato per `199,4 / 200`. Il
numero si inserisce nella tab Impostazioni → *Taratura disegnando*, un asse per
volta.

**Seconda lettura — come sbaglia, non solo quanto:**

| cosa vedi | cosa è |
|---|---|
| errore che cresce uniforme lungo il righello | il **rapporto**: si corregge col numero |
| uno scatto fra due tacche vicine | **gioco** o **passi persi**: un problema diverso, vedi 6 e 10 |
| tacche giuste ma linea di base **curva** | **rettilineità**: la trave flette o il portale imbarda |

La riga di base è lunga 200 mm apposta: appoggiandoci la riga d'acciaio si
legge la rettilineità di quell'asse nello stesso gesto.

## 4 — Squadro

**Cosa misuri:** le **due diagonali** fra le crocette d'angolo, col calibro o
con la riga. Le crocette ci sono perché fra due spigoli sfumati non si misura
niente.

**Il conto:**

```
errore di squadra (radianti) = (diagonale1 − diagonale2) / (1,414 × 128)
gradi = radianti × 57,3
```

**Cosa ti dice:** quanto i due assi sono fuori squadra. Mezzo grado fa **1,3 mm**
sull'angolo di un A5 — più di tutti gli altri errori messi insieme. Una volta
misurato si compensa via software, quindi non è un difetto da correggere a
mano: è un numero da prendere.

## 5 — Cerchi

**Cosa guardi:** i tre cerchi, a occhio e con la riga.

| cosa vedi | cosa è |
|---|---|
| esce un'**ellisse** | i mm per giro dei due assi non coincidono. Il verso dell'ellisse dice quale asse è lungo |
| **scalini** nei quattro punti dove un asse inverte il moto | è il **gioco** |
| scalini **uguali** sui tre raggi | gioco |
| scalini che **crescono** col raggio | scala, non gioco |

Tre raggi diversi servono proprio a questo: un errore di scala cresce col
raggio, un gioco no.

## 6 — Gioco

**Cosa misuri:** col calibro, **lo scarto orizzontale fra una tacca della fila
di sopra e la sua gemella di sotto**.

La fila di sopra è disegnata percorrendo l'asse in avanti, quella di sotto
tornando indietro. Quello scarto *è* il gioco d'ingranamento.

**Previsione dal CAD: 0,30 mm.** Se le due file si allineano a occhio, il gioco
sta sotto il decimo e la previsione era pessimista.

**Cosa ci fai:** non si compensa — non c'è un secondo riferimento con cui sapere
da che parte del gioco ci si trova. È il **limite di ripetibilità**: una linea
ripassata nel verso opposto può cadere fin lì di lato, e nessuna taratura lo
toglie.

## 7 — Stacchi

**Cosa guardi:** i trattini separati da spazi, e **gli spazi**.

| cosa vedi | cosa è | cosa fai |
|---|---|---|
| segni o strisciate negli spazi | la penna non fa in tempo ad alzarsi | alza la **pausa** della penna, o l'**alzata** |
| un pallino all'inizio di ogni trattino | la penna si appoggia e aspetta ferma | abbassa la pausa |
| spazi puliti e trattini netti | pausa e alzata vanno bene | niente |

I trattini della fila di sotto sono più corti: se la penna sbava, su quelli
corti si vede prima.

## 8 — Caratteri

**Cosa guardi:** la stessa scritta a 5, 4, 3, 2,5 e 2 mm. Trova **la più
piccola che resta leggibile**.

**Cosa ti dice:** la risoluzione utile della macchina **con quella penna**. Non
è un dato della macchina da sola: cambiando pennarello cambia. A 2 mm, con una
punta da 0,4, sono cinque larghezze di tratto — lì sotto non è la macchina a
non farcela, è il pennarello.

## 9 — Ripetibilità

Due colonne di otto trattini. Ogni trattino è disegnato arrivando **da lontano**,
e gli otto sono impilati uno sopra l'altro: se stessero sovrapposti non si
saprebbe nemmeno quanti ne sono stati disegnati.

**Colonna «SEMPRE DA SX»:** si arriva sempre dalla stessa parte, quindi il
gioco è sempre preso dallo stesso verso e **resta fuori dalla misura**.

- **bordo verticale netto** → la macchina ripete meglio della larghezza del
  tratto: la ripetibilità è sotto i due decimi
- **bordo seghettato** → misura la larghezza della banda col calibro, meno la
  larghezza del tratto: quella è la **ripetibilità**

**Colonna «ALTERNATO»:** si arriva un colpo da destra e uno da sinistra, quindi
il gioco entra nella misura. La banda sarà più larga.

**La differenza fra le due bande è il gioco**, ed è una **seconda lettura
indipendente** da quella della prova 6. Se i due numeri non tornano, uno dei
due è sbagliato — e di solito è quello preso col calibro su tacche sottili.

## 10 — Velocità

Quattro righe lunghe uguali, disegnate a **600, 1200, 2400 e 4800 mm/min**, fra
due righe verticali che le tagliano tutte.

**Cosa guardi:** se ogni riga **tocca** la verticale d'arrivo.

| cosa vedi | cosa è |
|---|---|
| una riga non arriva alla verticale | a quella velocità il motore **perde passi** |
| una riga la supera | idem, nell'altro verso |
| tutte arrivano, ma le veloci sono più chiare | il pennarello non fa in tempo a rilasciare inchiostro |

**Cosa ci fai:** la velocità massima di lavoro va messa **sotto** quella in cui
compare il problema, con un buon margine. È il numero che va nel profilo come
*velocità di disegno*.

Le righe sono lunghe 100 mm di proposito: con 200 mm/s² di accelerazione
servono 16 mm solo per arrivare a 80 mm/s, quindi su un tratto corto la
macchina non raggiunge mai la velocità che le hai chiesto e la prova non
misurerebbe niente.

## 11 — Livello

**L'unica prova che non sta in un riquadro, e non può starci:** deve campionare
tutta l'area, quindi i **nove nodi** sono sparsi dentro gli altri riquadri, nei
punti vuoti. Ognuno è marcato `11`.

In ogni nodo ci sono **quattro trattini affiancati**, ognuno **0,30 mm più in
alto** del precedente.

**Cosa fai: conta i trattini che hanno segnato.**

| trattini | il piano lì è |
|---|---|
| **0** | **più basso** del contatto: la penna non tocca |
| **1** | alla quota giusta |
| **2** | alto di ~0,3 mm |
| **3** | alto di ~0,6 mm |
| **4** | alto di ~0,9 mm o più |

Scrivi i nove numeri su uno schizzo del foglio: quella è la **mappa del piano**.

**Come si legge la mappa:**

- numeri che **crescono in una direzione** → il piano è inclinato. Si corregge
  spessorando da un lato
- numeri alti agli angoli e bassi al centro (o viceversa) → il piano è
  **imbarcato**, e lo spessoramento non basta
- angoli opposti alti e gli altri due bassi → il piano è **svergolato**, ed è
  il caso peggiore: non esiste un piano che passi per tutti e quattro

**Perché conta tanto su questa macchina:** il modulo penna **non ha molla**, la
penna in Z è rigida. Il fuori-piano non si assorbe — dove il piano scende la
penna non tocca, dove sale preme. Il gradino è 0,30 mm perché è la banda morta
del servo: più fine di così il servo non sa muoversi, e si misurerebbe il
rumore.

---

## Dopo: cosa finisce nel profilo

| prova | numero che ne esce | dove va |
|---|---|---|
| 2, 3 | mm per giro ingranaggio, per asse | Impostazioni → Trasmissione |
| 4 | errore di squadra | da compensare nel generatore (non c'è ancora il campo) |
| 6, 9 | gioco | Impostazioni → Trasmissione, in sola lettura |
| 7 | pausa della penna, alzata | Impostazioni → Profilo di stampa / Penna |
| 9 | ripetibilità | Impostazioni → Homing |
| 10 | velocità di disegno | Impostazioni → Profilo di stampa |
| 11 | mappa del piano | non è un campo: è un intervento meccanico |
