# L'alimentazione della macchina

Aperto il **2026-11-27**, dopo tre stampe perse per il riavvio dell'ESP32 e
dopo aver scoperto che di questo sottosistema **nel repository non c'era una
riga**: cercando `7805`, «regolatore» e «alimentatore» in tutto il progetto si
trovava solo la batteria del telecomando, che è un altro oggetto. Non poterlo
leggere ha portato a inseguire per tre sere cause che stavano altrove — prima
il telecomando, poi la rete, poi il carico della pagina.

**Lo stato di ogni numero è dichiarato riga per riga**, perché questo documento
nasce da una frase dell'utente e non da una misura: `detto` = riferito,
`calcolato` = ricavato qui, `da misurare` = non lo sa ancora nessuno.

---

## Come è fatta adesso

| Cosa | Valore | Stato |
|---|---|---|
| Alimentatore unico | da definire | **da misurare** (tensione e ampere) |
| Regolatore 1 | **L7805**, alimenta l'**ESP32** | detto |
| Regolatore 2 | **L7805**, alimenta il **servo** del pen-lift | detto |
| Dissipatori sui due L7805 | — | **da misurare** |
| Motori passo-passo | dall'alimentatore, prima dei regolatori | da confermare |

Due regolatori **separati**: lo strappo di corrente del servo non tira giù
direttamente il 5 V dell'ESP32. È la scelta giusta, ed esclude il guasto più
banale — i due che si litigano lo stesso rail.

---

## Perché il L7805 è comunque il sospettato

**Un L7805 è lineare: la differenza di tensione la trasforma in calore.** Non
la converte, la brucia. La potenza dissipata è `(Vin − 5) × I`, e finisce tutta
nel contenitore TO-220.

Con un alimentatore a 12 V (`da confermare`):

| Ramo | Corrente | Dissipata | Stato |
|---|---|---|---|
| ESP32, media con WiFi acceso | ~250 mA | **1,75 W** | calcolato |
| ESP32, picchi in trasmissione | ~400 mA | 2,8 W | calcolato |
| Servo in movimento | ~600 mA | **4,2 W** | calcolato |
| Servo che forza contro un fine corsa | ~1 A | 7 W | calcolato |

Un TO-220 **senza dissipatore** ha una resistenza termica verso l'aria
dell'ordine di 50÷65 °C/W. A 1,75 W sono **90÷115 °C sopra l'ambiente**; la
protezione termica del L7805 interviene intorno ai 150 °C di giunzione. Il ramo
dell'ESP32 sta quindi **sul filo**, e il ramo del servo è ben oltre.

**La protezione termica non è un guasto permanente: stacca, raffredda,
riattacca.** È esattamente la firma di una scheda che si riavvia dopo qualche
minuto di lavoro e poi riparte senza problemi.

E combacia con l'altra osservazione: tutte e quattro le cadute sono arrivate
**nella parte fitta del disegno**, dove le alzate di penna al secondo sono di
piu' e il regolatore del servo lavora di piu'. Con l'ingresso in comune, un ramo
che tira giu' la tensione d'ingresso toglie margine anche all'altro: il L7805
vuole almeno ~7 V in ingresso per tenere 5 V in uscita.

> **Non è dimostrato.** È l'ipotesi che spiega meglio le quattro cadute, e si
> verifica con un tester, non con un ragionamento.

---

## Cosa manca per chiudere la questione

1. **La tensione dell'alimentatore** e quanti ampere dichiara. A 24 V invece che
   a 12 la potenza dissipata piu' che raddoppia e lo spegnimento termico
   diventa una certezza.
2. **Se i due L7805 hanno un dissipatore.**
3. **Il 5 V dell'ESP32 misurato col tester durante la parte fitta** di una
   stampa. Se cala o sparisce, abbiamo finito.

## Il rimedio, se è quello

Un dissipatore è la versione da cinque minuti. La versione giusta è sostituire
i due lineari con due **convertitori a commutazione** (moduli buck 12 V → 5 V,
qualche euro): non scaldano, perche' non bruciano la differenza — la convertono.
Il ramo del servo lo vuole comunque, perche' 4 W continui un TO-220 nudo non li
regge in nessun caso.
