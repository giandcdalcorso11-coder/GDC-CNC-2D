# I cavi, il box del circuito e gli alloggiamenti

Progetto aperto il **2026-10-27**, su richiesta dell'utente: i fili dei motori e
del servo strisciano sul piano, e non deve succedere. Dietro a quella richiesta
ce ne sono altre due — il circuito a vista dentro a un box col coperchio
trasparente, e un alloggiamento a sinistra per fogli, penne e moduli — e
conviene trattarle insieme, perché si contendono lo stesso spazio.

I numeri vengono dal CAD letto il 2026-10-22 (`cad-assieme.md`) e dalle corse
misurate sulla macchina. Quelli che **mancano** sono segnati come tali: non si
disegna un box attorno a una scheda di cui non si conosce l'ingombro.

---

## Lo spazio che c'è davvero

La tavola è **700 × 600**, faccia superiore Z 0. La zona di disegno sta in
X −206,20 … 47,03 e Y −217,91 … 20,15. Da lì in poi:

| Striscia | Larghezza | Che cosa c'è sopra |
|---|---|---|
| **sinistra, X −493,74 … −353,70** | **140,0 mm** | **niente**: la trave finisce a X −353,70, quindi qui l'altezza è libera |
| sinistra, X −353,70 … −206,20 | 147,5 mm | la trave ci passa sopra: **soffitto a Z 104,18** |
| destra, X 47,03 … 206,26 | 159,2 mm | la cremagliera dell'asse Y occupa X 78,28 … 116,94 |
| davanti, Y < −217,91 | 32,8 mm | il lato stretto: non ci si mette niente |
| dietro, Y > 20,15 | 329 mm | libero |

**Il numero che decide il progetto del box è 140,04.** A sinistra ci sono due
strisce, non una: la prima è libera in altezza, la seconda ha un soffitto di
104 mm perché la trave del portale ci spazza sopra a ogni movimento dell'asse Y.
Un box alto 120 mm messo nel posto sbagliato viene preso in pieno dalla trave.

> **Da verificare col metro prima di tagliare qualsiasi cosa.** Le quote del CAD
> sono prese dai vertici del STEP, ma la posizione dei blocchi di homing è
> dedotta dalla geometria e vale ±2 mm (vedi `cad-assieme.md`). I 140 mm di
> striscia libera sono il numero da confermare per primo.

---

## I cavi

### Che cosa deve viaggiare

| Da | A | Fili | Si muove con |
|---|---|---|---|
| controller | motore asse Y | 4 | niente: il motore dell'asse Y è fisso |
| controller | motore asse X | 4 | il portale (asse Y) |
| controller | servo del pen-lift | 3 | il portale **e** il carrello (assi Y e X) |

Il servo è l'unico che fa tutti e due i percorsi, e per questo il conto dei fili
sulla trave è 7 e non 3: il motore dell'asse X sta sul portale ma il suo cavo
arriva dal controller, quindi i due cavi corrono insieme per il primo tratto.

### I due percorsi, e perché non sono simmetrici

**Asse X — sopra la trave.** La faccia superiore della trave è a **Z 127,68** e
sopra non c'è niente. Un cavo che corre lì è a 128 mm dalla tavola: più in alto
del foglio, più in alto della penna, più in alto di qualunque cosa si appoggi
sul piano. È il posto giusto, e non per eleganza — è l'unico che toglie il cavo
dal piano invece di spostarlo di qualche centimetro.

**Asse Y — a destra, fuori dalla zona di disegno.** Il portale si muove in Y, e
il suo cavo deve seguirlo. La striscia a destra è larga 159 mm e la cremagliera
ne occupa 39: resta spazio fra X 120 e X 200, che è **fuori dalla zona di
disegno di 73 mm**. Lì un portacavi può stare appoggiato alla tavola senza
toccare mai niente.

A sinistra non si può: quella striscia serve agli alloggiamenti, e il cavo
dell'asse Y dovrebbe comunque arrivare al portale, che è motorizzato a destra.

### Catena portacavi stampata: i numeri

Passo **16 mm**, raggio di curvatura **30 mm** — che vuol dire **30° per
giunto**, un valore normale per una catena stampata; sotto i 20° le maglie
diventano tante e sopra i 40° il perno lavora male.

Il raggio non è scelto a occhio: un cavo a 4 conduttori da Ø4 mm vuole un raggio
di curvatura di almeno 5÷10 volte il proprio diametro, cioè 20÷40 mm. Trenta sta
in mezzo e vale per tutti e due i cavi.

| | Corsa | Lunghezza catena | Maglie | Altezza dell'ansa |
|---|---|---|---|---|
| asse X (carrello sulla trave) | 253,2 mm | **261 mm** | 17 | 84 mm |
| asse Y (portale sulle rotaie) | 238,1 mm | **253 mm** | 16 | 84 mm |

La lunghezza è `corsa / 2 + π · raggio + 40` di margine: metà corsa perché
l'estremo fisso si mette a **metà corsa** e la catena lavora simmetrica, π·R per
il mezzo giro dell'ansa, il margine per gli attacchi.

**L'ansa è alta 84 mm** (2 × raggio + 2 × l'altezza esterna della maglia). Sulla
destra non è un problema: lì il soffitto è il cielo. Sopra la trave nemmeno.

Sezione interna proposta: **10 × 8 mm**, pareti 2 mm, quindi **14 × 12 esterni**.
Dieci millimetri di larghezza bastano per sette fili sottili affiancati; se si
preferisce tenere i due cavi separati, meglio due catene strette che una larga —
i fili che si accavallano dentro a una catena si consumano l'uno contro l'altro.

### Le tre strade, messe a confronto

| | Pro | Contro | Quando |
|---|---|---|---|
| **Catena stampata** | tiene il cavo su un percorso preciso, non si impiglia, si ripara una maglia per volta | 84 mm di ansa, massa in più sull'asse, 33 maglie da stampare | la scelta buona per l'asse Y |
| **Cavo piatto a U** (come le testine delle stampanti 3D) | leggerissimo, niente da stampare, ansa di pochi millimetri | vuole un cavo piatto vero, e va guidato ai due capi | la scelta buona per l'asse X, sopra la trave |
| **Cavo sospeso in alto** | zero attrito, zero massa | serve un sostegno sopra la macchina, e il cavo oscilla | se un giorno la macchina avrà una struttura sopra |

**Proposta:** catena sull'asse Y, cavo piatto sulla trave per l'asse X. Non è
pigrizia: l'asse X porta la penna, e ogni grammo sul carrello è massa che
l'accelerazione deve muovere e che l'imbardata amplifica per lo sbalzo di 70 mm
(vedi `cad-assieme.md`). Una catena da 17 maglie lì è massa messa nel posto
peggiore della macchina.

### Che cosa manca per disegnarla

1. la **sezione della rotaia destra** e dove ci si può avvitare: il CAD ha la
   cremagliera, non la rotaia;
2. **dove sta il controller**, che decide da che parte entra il cavo;
3. il **diametro vero dei cavi** che userai — i 10 mm di larghezza interna sono
   dimensionati su una stima.

---

## Il box del circuito

Coperchio trasparente, circuito a vista: è una scelta di **figura-sfondo**, la
stessa del logo — si mostra il meccanismo invece di nasconderlo.

**Dove.** Nella striscia libera a sinistra, X −493,74 … −353,70: 140 mm di
larghezza e nessun soffitto. È l'unico posto della tavola dove un box può essere
alto quanto serve senza che la trave lo prenda.

**Quanto può essere grande.** 140 mm in X, e in Y quanto si vuole fino a 600.
L'altezza è libera, ma oltre i ~128 mm (la faccia alta della trave) il box
diventa la cosa più alta della macchina e cambia la sagoma dell'oggetto: è una
decisione estetica, non meccanica.

**Che cosa manca:** l'ingombro della scheda FluidNC con i due driver montati,
dell'alimentatore e dei morsetti. Senza quei tre numeri il box non si disegna —
si disegna un contenitore generico, che è un'altra cosa.

---

## Gli alloggiamenti

Nella seconda striscia a sinistra, X −353,70 … −206,20: **147,5 mm di larghezza,
600 di profondità, soffitto a Z 104,18**.

| Cosa | Ingombro | Ci sta? |
|---|---|---|
| fogli A5 in piano (210 × 148) | 210 in Y, 148 in X | **sì**, con 148 contro 147,5 — al pelo, da verificare |
| fogli A5 in piedi in una tasca | 148 in Y, pochi mm in X | sì, largamente |
| penne / pennarelli in piedi | Ø ~15, alti ~140 | **no in piedi**: 140 contro 104 di soffitto. Coricate sì |
| modulo penna di ricambio | 80 × 42 × 76 (da `modulo tratto-pen pz1`) | sì |

**Due numeri che decidono la forma dell'alloggiamento**, e vanno detti subito:

- **i fogli A5 in piano entrano per mezzo millimetro.** 148 di lato corto contro
  147,5 di striscia. Non si progetta niente su mezzo millimetro: o i fogli stanno
  **in piedi in una tasca**, o il vano si allarga sconfinando sotto la trave e
  allora deve essere basso;
- **le penne in piedi non ci stanno.** Un pennarello da 140 mm sotto un soffitto
  di 104 non entra. Vanno coricate in canaline, oppure messe in piedi nella
  striscia libera accanto al box — dove l'altezza non ha limiti.

La conseguenza è che l'alloggiamento **non è un oggetto solo**: è un vano basso
sotto la trave (fogli coricati, moduli) più una rastrelliera alta accanto al box
(penne in piedi). Scoprirlo adesso costa una riga; scoprirlo dopo aver stampato
costa una stampa.

---

## Ordine di lavoro proposto

1. **misurare** i tre numeri che mancano (sezione rotaia, ingombro scheda,
   diametro cavi) e confermare col metro i 140 mm di striscia libera;
2. **cavo piatto sulla trave** per l'asse X: è la metà che toglie subito il filo
   dal piano, e non chiede niente da stampare;
3. **catena sull'asse Y**: 16 maglie, passo 16, raggio 30;
4. **box** e **alloggiamenti**, che sono gli unici due pezzi che si contendono
   la stessa striscia e vanno disegnati insieme.
