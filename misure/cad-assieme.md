# L'assieme CAD letto numero per numero

Ricavato dal STEP `Assembly_1_tot_con_modulo_tratto_pen` esportato da Onshape il
**2026-10-22**, il primo che contiene il modulo penna montato. Serve a tre cose:
fissare il sistema di riferimento, dire dove sta la punta, e dire quanta aria
c'è sotto la testina.

I numeri sono letti dai vertici del STEP con le trasformazioni dell'assieme
applicate, non misurati a schermo.

---

## Il sistema di riferimento

**La faccia superiore della tavola è Z = 0.** Tutte le quote verticali di questo
documento sono sopra quella faccia.

| Pezzo | X | Y | Z |
|---|---|---|---|
| `base legno v2` | −493,74 … 206,26 (**700**) | −250,67 … 349,33 (**600**) | −20 … **0** |
| `foglio A4` (riferimento) | −239,62 … 57,38 (297) | −221,74 … −11,74 (210) | 0 … 1 |

Il controllo che dice che la lettura è giusta: il punto più basso del carrello X
esce **Z 46,68**, lo stesso numero registrato il 2026-10-06 e confermato col
metro il 2026-10-15.

---

## Attenzione ai nomi: nel CAD sono scambiati

I nomi dei pezzi sono quelli vecchi e non seguono la convenzione del progetto
(**X** = carrello sulla trave, **Y** = portale sulle rotaie di base):

| Nome nel CAD | Cos'è davvero |
|---|---|
| `blocco  sx asse Y` | il blocco di homing **dell'asse X**, sulla trave |
| `blocco front X` | il blocco di homing **dell'asse Y**, sulla rotaia destra |
| `cremagliera Y` | la cremagliera **dell'asse X**, sotto la trave |
| `cremagliera X dx` | la cremagliera **dell'asse Y**, sulla rotaia |
| `Spur gear (25 teeth)` | il pignone **del pen-lift**, non di un asse |
| `staffa` | la staffa **LL**, la trave del portale |

Le posizioni invece sono giuste: è su quelle che sono presi i numeri qui sotto.

---

## Dove sta la punta della penna

La penna non è modellata — è quella che si infila nei morsetti. La sua **sede**
però sì, ed è una **sede a V** ricavata su `modulo tratto-pen pz2`, con una
seconda V sul morsetto mobile (`attacco 1` e `attacco 2`) che la chiude.

La V di `pz2`: bocca larga 10,00 mm a X −195,18, apice a X −192,18 (profondità
3,00), bisettrice su **Y −215,78**. Un cerchio Ø10 tangente alle due facce ha il
centro a `r / sin θ` dall'apice, con θ = atan(5/3) = 59,04°, cioè 5,831 mm — e i
punti di tangenza cadono **esattamente sulla bocca della V**. La sede è disegnata
per Ø10, che è il diametro del Tratto Pen.

> **Asse della penna: X −198,01 · Y −215,78** (posa del CAD)

La controprova: la V del morsetto ha bocca 10,00 e profondità 3,68, θ = 53,65°,
e anche lì la tangenza cade sulla bocca — un'altra sede per Ø10. Nella posa del
CAD il morsetto è **aperto di 3,46 mm**; stringendolo, la sua V arriva proprio
sull'asse che dà la V di `pz2`.

### Lo sbalzo, che è il numero che conta per l'imbardata

| Da | A | In Y |
|---|---|---|
| mezzeria del carrello X (Y −145,31) | punta | **−70,47 mm** |
| faccia vicina della trave (Y −164,84) | punta | **−50,94 mm** |

In X la punta è a **+7,67 mm** dalla mezzeria del carrello, cioè praticamente
centrata — è la direzione buona. Tutto lo sbalzo è in Y, che è l'asse motorizzato
su un lato solo: l'errore di posizione è l'imbardata del portale moltiplicata per
questo braccio. È la misura che fa la **prova 2** del disegno di collaudo
(diagonali del quadrato).

---

## Quanta aria c'è sotto la testina

| Punto più basso di… | Z |
|---|---|
| `modulo tratto-pen pz2` (stadio flottante) | **26,68** |
| `coprivite 2` | 27,44 |
| `vite2` | 30,91 |
| `attacco 2` (morsetto inferiore) | 31,68 |
| `servomotore` | 41,68 |
| `Spur gear (25 teeth)` (pignone pen-lift) | 43,35 |
| `carrello` X | 46,68 |

Nella posa del CAD la parte più bassa della testina passa a **26,68 mm** sopra la
tavola. Portando lo stadio flottante a fondo corsa in discesa (10,00 mm dalla
posizione modellata, nota del 2026-10-16) si scende a **16,68 mm**.

**Conseguenza per il fissaggio del foglio.** Il vincolo non è più la testina: è
**l'alzata della penna, 2,945 mm**, perché è quello che passa sopra il foglio fra
un tratto e l'altro. Qualunque cosa appoggiata sul foglio più alta di ~2,9 mm
viene presa dalla punta molto prima che dal carrello. Il nastro di carta (0,1 mm)
resta la scelta giusta; una molletta o una calamita no, ma per questo motivo e
non per i 2,5 mm che si erano calcolati quando era prevista la piattaforma.

---

## L'area di disegno sulla tavola

La posa del CAD non è l'home: i carrelli sono fermi a **8,19 mm** dal blocco X e
a **2,13 mm** dal blocco Y. Sottraendoli, e aggiungendo le corse misurate sulla
macchina (256,089 su X e 243,071 su Y dall'home):

| | punta al punto ai blocchi | fino a |
|---|---|---|
| X | −206,20 | 49,89 |
| Y | −217,91 | 25,16 |

**Margini sul bordo della tavola:** 287 mm a sinistra, 156 a destra, **32,8
davanti**, 324 dietro. Tutta la zona di disegno è sulla tavola, e il lato stretto
è quello davanti — che è esattamente il motivo per cui la cremagliera dell'asse X
è stata spostata.

Questi due numeri dipendono da quali facce toccano i blocchi, dedotte dalla
geometria e non misurate: **vanno presi a ±2 mm** finché non si disegna davvero.
Le corse, invece, sono misurate e certe.

### L'A4 non ci sta, e non è una novità

L'area percorribile è **254,09 × 241,04 mm**. L'A4 chiede 297 in un verso, quindi
non entra in nessun orientamento. Il `foglio A4` nel CAD è un riferimento, non un
formato stampabile: sborda di 33 mm a sinistra, 7,5 a destra e 3,8 davanti.

| Formato | Entra? |
|---|---|
| A5 210 × 148 | sì, largamente |
| B5 250 × 176 | sì |
| quadrato 241 × 241 | sì, al limite |
| A4 297 × 210 | **no** |

---

## Posizioni da cui ripartire al prossimo CAD

Da confrontare quando arriverà la prossima versione, per vedere cosa si è mosso:

| Pezzo | X | Y | Z |
|---|---|---|---|
| `cremagliera Y` (= asse X) | −226,26 … 71,10 | −127,99 … −99,54 | 81,56 … 126,18 |
| `cremagliera X dx` (= asse Y) | 78,28 … 116,94 | −157,69 … 125,34 | 0 … 68,38 |
| `blocco  sx asse Y` (= blocco X) | −273,70 … −248,90 | −164,84 … −116,84 | 127,68 … 149,68 |
| `blocco front X` (= blocco Y) | 122,50 … 197,20 | −231,00 … −182,00 | 8,00 … 53,20 |
| `staffa` (trave LL) | −353,70 … 196,30 | −164,84 … −97,74 | 104,18 … 127,68 |
| `modulo tratto-pen pz1` | −235,98 … −156,88 | −201,11 … −159,81 | 31,68 … 107,48 |
| `modulo tratto-pen pz2` | −224,08 … −185,48 | −222,88 … −186,38 | 26,68 … 81,68 |
