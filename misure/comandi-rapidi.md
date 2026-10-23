# Comandi rapidi

I comandi che si usano davvero, da digitare nella console di FluidNC. I numeri
escono dal profilo macchina: se cambia una taratura, questa pagina va
rigenerata insieme al `config.yaml`.

**Lo zero è il punto ai blocchi**, l'angolo in basso a sinistra, e lo mette
`G92` a mano: non sopravvive a un riavvio.

**Le quote Z sono negative.** Senza finecorsa FluidNC mette lo zero macchina in
cima alla corsa del servo. Una quota positiva non è «più in alto»: è fuori
corsa, e `mapConstrain` la tronca su `Z0` senza dire niente.

## La penna

| comando | cosa fa |
|---|---|
| `G0 Z0` | posizione **tappo**, 90°, in cima alla corsa. È anche dove il servo si porta all'accensione |
| `G0 Z-18.326` | penna **alzata** di lavoro, 34°. 2,945 mm sopra il foglio: è la quota fra un tratto e l'altro |
| `G0 Z-21.271` | penna **sul foglio**, 25°. Fondo corsa, quota di contatto nominale |
| `G0 Z-3` | una quota qualsiasi dentro la corsa, per vedere se il servo risponde |

La battuta dei cuscinetti è a 17°, cioè `Z-23.889`: sta **fuori** dall'arco che
FluidNC può comandare, ed è voluto — il software non deve mai poterla
raggiungere.

## I punti

| comando | cosa fa |
|---|---|
| `G90 G0 X0 Y0 F3000` | **lo zero**, il punto ai blocchi. Ci arriva appoggiandosi al riferimento: usalo per controllare, non per parcheggiare |
| `G90 G0 X5 Y5 F3000` | **punto home**, 5 mm dentro da entrambi i blocchi. È dove si parcheggia: un carrello fermo contro il riferimento prima o poi lo sposta |
| `G90 G0 X120.616 Y118.032 F3000` | **centro dell'area utile** |
| `G90 G0 X240.5 Y235.5 F3000` | **angolo opposto**, il punto utile più lontano |
| `G90 G0 X240.5 Y0.5 F3000` | angolo in **basso a destra** |
| `G90 G0 X0.5 Y235.5 F3000` | angolo in **alto a sinistra** |

L'area utile è **241,232 × 236,064 mm**. Gli angoli qui sopra stanno mezzo
millimetro dentro, e oltre il tratto restano comunque i 2 mm di margine di
sicurezza già tolti dalla corsa percorribile.

**X si è accorciata di 10 mm il 2026-10-23**, e non per taratura: sul lato
destro il pignone del carrello tocca la cremagliera dell'asse Y prima che il
carrello arrivi in fondo. Erano 251,232. Si recuperano spostando la
cremagliera, non diventando più precisi.

## L'origine, in quest'ordine

| comando | cosa fa |
|---|---|
| `$MD` | libera i motori (`$Motor/Disable`). `$MD=X` per un asse solo |
| | appoggia i carrelli ai blocchi, **senza forzarli** |
| `G92 X0 Y0` | mette lo zero dove sei. Non muove niente, funziona anche a motori molli |
| `G90 G0 X5 Y5 F1000` | va al punto home. **Non è facoltativa**: è il primo movimento, quindi è lei a riaccendere i motori |

Niente comando riabilita i motori: lo fa qualunque movimento. Fra il `G92` e la
riga dopo non fermarti — finché i motori sono molli una spinta accidentale
falsifica lo zero in silenzio.

## Muoversi a mano

| comando | cosa fa |
|---|---|
| `$J=G91 X25 F300` | jog **relativo** di 25 mm verso destra. Si ferma da solo, non cambia i modali |
| `$J=G91 Y-25 F500` | jog di 25 mm verso di te |
| `$J=G91 Z-0.2 F100` | abbassa la penna di due decimi |
| `G91` / `G90` | passa a coordinate relative / assolute. **Rimetti sempre `G90`** |

## I file

| comando | cosa fa |
|---|---|
| `$LocalFS/List` | cosa c'è nella flash, con le dimensioni |
| `$LocalFS/Size` | totale e usato della flash |
| `$LocalFS/Run=nome.gcode` | esegue un programma dalla flash |
| `$LocalFS/Delete=nome.gcode` | cancella un file |

Per caricare, dal PC — il pannello della WebUI punta alla SD, che non c'è:

```
curl -T file.gcode http://192.168.1.14/flash/file.gcode
```

## Stato e controllo

| comando | cosa fa |
|---|---|
| `?` | stato e posizione, subito |
| `!` | **feed hold**: ferma il movimento tenendo la posizione |
| `~` | **cycle start**: riparte dopo un `!` o dopo un `M0` del programma |
| `Ctrl-X` | reset: ferma tutto e azzera il parser. Lo zero `G92` resta |
| `$CD` | rilegge tutta la configurazione come FluidNC l'ha capita |
| `$Bye` | riavvia il controller |

## Dentro un programma

| comando | cosa fa |
|---|---|
| `G21` | millimetri |
| `G90` | coordinate assolute |
| `G0 X.. Y..` | spostamento rapido, a penna alzata |
| `G1 X.. Y.. F1200` | tratto disegnato, alla velocità di lavoro |
| `G4 P0.2` | pausa di due decimi: il servo ci mette un po' ad arrivare |
| `M0` | **pausa programma**: si ferma e aspetta `~`. Serve dove servono le mani |
| `M2` | fine programma |

Le velocità del profilo di stampa: **disegno 1200**, **spostamento 3000**,
**pausa penna 200 ms**.
