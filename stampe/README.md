# Stampe

Progetti da stampare con la macchina: biglietti, magneti, loghi, mascotte. Ogni lavoro parte da una
**scheda** (le specifiche), passa da **uno script solo** (`lavoro.py`) che sceglie il motore giusto, e
esce con un **controllo** (ingombro, sollevamenti di penna, tratti sovrapposti).

**Catalogo con le anteprime: [`catalogo/index.html`](catalogo/index.html)** (si apre nel browser;
si rigenera con `python3 -B catalogo.py`).

## Lo strumento (la pagina per dare le specifiche)

`strumento/` è una pagina con dropbox per il file, pulsanti per lo stile (si accendono solo quelli adatti
al file), slider per il dettaglio, foglio, vista del modello 3D (con anteprima da sei angoli), ritaglio,
scritte e un riquadro per le richieste. Genera la scheda e, se il motore è collegato, anche il disegno.

```bash
python3 -B stampe/strumento/strumento.py          # poi apri http://127.0.0.1:8765
```

- **Con il motore** (il comando sopra): «Genera» lancia `lavoro.py`, mostra l'anteprima e il report e
  offre il download dell'SVG e della scheda. Serve Python 3 con `numpy` e `Pillow` (`pip install numpy pillow`)
  e `node` per le scritte. Un lavoro alla volta; i file stanno in `strumento/_lavori/` (non nel repo).
- **Senza motore** (si apre `strumento/index.html` da solo): la pagina diventa «Prepara scheda» e dà la scheda
  da mandare a Claude insieme al file.
- `python3 -B strumento.py --host 0.0.0.0` lo rende raggiungibile da altri dispositivi della rete.
- `python3 -B strumento.py --build` riscrive `index.html` (da rifare se cambiano stili o penne).

### Scala del dettaglio e anteprime «i»

- La scala base ha tre scatti. Le due **spunte** sotto lo slider la estendono: a sinistra fino a *minimo* (sagoma e poco
  altro), a destra fino a *massimo* (molto fitto: il controllo segnala quando le linee si impastano). Nella scheda il
  livello è il nome: `minimo`, `molto-essenziale`, `essenziale`, `medio`, `dettagliato`, `molto-dettagliato`, `massimo`.
- Le icone **i** accanto a ogni stile e al dettaglio mostrano, al passaggio del mouse, le anteprime degli esempi veri
  (per il dettaglio: quelli dello stile scelto, uno per livello, col livello scelto evidenziato).
- Gli esempi stanno in `catalogo/esempi.json`, ognuno col suo stile e livello. **Si aggiungono così:** col pulsante
  «Aggiungi agli esempi» sotto un risultato dello strumento, oppure da riga di comando
  `python3 -B catalogo.py --aggiungi <cartella-del-lavoro> --titolo "..."` (la cartella con `<nome>.svg`,
  `scheda.json`, `report.txt`). L'esempio va sotto il suo stile e livello, nel catalogo e nelle «i».

## Come si lavora

1. **Modulo.** A ogni nuovo lavoro ti faccio le domande qui sotto (a scelta, più i campi liberi).
2. **Scheda.** Con le risposte compilo la scheda (un JSON) e la salvo nella cartella del lavoro.
3. **Generazione.** `python3 -B lavoro.py scheda.json` → `<nome>.svg`, `scheda.json`, `report.txt`.
4. **Anteprima e numeri.** Ti mando il disegno con tratti, lunghezza, sollevamenti, ingombro.
5. **Correzioni.** Correggo sui tuoi segni. Il file che rifinisci nello SLICER prevale su quello
   generato e si salva come riferimento (`finali-utente/`, `finale/`).

## Il modulo (le domande)

Primo giro, a scelta:

| Campo | Valori |
|---|---|
| **Ingresso** | modello 3D (`.3mf`, con vista) · foto · screenshot · illustrazione/logo |
| **Stile** | Rilievo · Layer · Onde · Poligoni · Linea · Fedele (· Tratti, sconsigliato) |
| **Dettaglio** | essenziale · medio · dettagliato (scala estesa: minimo, molto essenziale, … molto dettagliato, massimo) |
| **Foglio** | A5 orizzontale 210×148 · A5 verticale 148×210 · quadrato · altro (mm) |

Secondo giro, a parole: **penne** (quali usi e cosa va in ciascuna; default: tutte le scritte in
indelebile, il resto lo scelgo io) · **testi** (cosa e dove; senza altre indicazioni niente logo GDC,
lo aggiungi tu dallo SLICER) · **da non fare** («niente sfondo», «tieni i contorni»…) · **vista**
per i modelli 3D · **ritaglio** per le foto.

## La scheda

```json
{
  "nome": "biglietto-cliente",
  "ingresso": {"tipo": "modello3d", "file": "modello.3mf", "vista": {"rz": 20, "rx": 10}},
  "stile": "rilievo",
  "dettaglio": "dettagliato",
  "foglio": {"w": 210, "h": 148, "margine": 8},
  "testi": [{"s": "NOME", "base": 128, "alt": 9, "penna": "nero"},
            {"s": "dedica", "base": 140, "alt": 4.2, "penna": "grigio"}],
  "opzioni": {}
}
```

- `ingresso.tipo`: `modello3d` · `foto` · `screenshot` · `illustrazione` (`icona` è un sinonimo). Per le foto, `ritaglio`: `"su,giu,sx,dx"` in px.
- `vista`: `rz` = giro attorno alla verticale, `rx` = inclinazione dall'alto (0 = di fronte, 90 = dall'alto).
- `testi`: sotto il disegno (`base` = riga su cui poggiano, in mm dal bordo alto). Se ci sono, il disegno
  si ferma 4 mm sopra la scritta più alta. Font a tratto singolo della macchina; `penna` da `penne.json`.
- `opzioni` (tutte facoltative): `livelli`, `sigma`, `px`,
  `oggetto` (`"object_4.model:1"`), `escludi`/`taglia` (liste `"x0,y0,x1,y1"`), `passo`/`onda`
  (Onde), `lato`/`senza_toni` (Poligoni), `colori`/`riempimento` (Fedele); per **Linea**: `testo` (frazione dell'altezza da cui in giù è
  scritta), `blob`, `marker`, `sottile` (`fine`|`marker`), `esterno`, `testo_fine`.
- `uscita`: cartella di destinazione (default `stampe/lavori/<nome>/`).

`python3 -B lavoro.py --esempio` stampa una scheda; `--stili` elenca gli ammessi.

## Gli stili

| Stile | Da | Cosa fa | Dettaglio (essenziale → dettagliato) |
|---|---|---|---|
| **Rilievo** | modello 3D, screenshot | linee **organiche** che seguono la forma: sagoma nera + curve di livello grigie (distanza dall'osservatore) | ~12 curve · ~20 · ombreggiatura con tratti scuri (occhi, pieghe) |
| **Layer** | modello 3D | fette alla stessa quota, come gli strati di una stampa 3D: linee **parallele** | 12 · 20 · 28 strati |
| **Onde** | foto | righe orizzontali ondulate continue; l'onda cresce dove la foto è scura | passo 2,8 → 2,2 → 1,7 mm |
| **Poligoni** | foto | mosaico di triangoli, fitti dove c'è dettaglio | 9 mm → 7 mm → 7 mm con toni |
| **Linea** | illustrazione/logo | una linea per tratto, due penne; regola delle scritte per l'indelebile | (nessun livello: si regola per parti) |
| **Fedele** | illustrazione/logo | riporta l'immagine il più fedelmente possibile: contorno di ogni campitura (non per le foto) | grana e semplificazione: più pulito → più particolari |
| Tratti | foto | tratteggio incrociato | sconsigliato: migliaia di trattini corti; tarato solo sulla foto della coppia |

## Regole fisse

- **Una linea sola per tratto.** Lo spessore lo sceglie la penna del livello nello SLICER.
- **Un colore = un livello = una penna.** Nei file il colore è solo l'etichetta del livello
  (`penne.json`): nero `#111111` e grigio `#8a8a8a` = Tratto Pen (~0,5 mm); `#6b6b6b` = indelebile (1,5 mm).
- **Scritte per l'indelebile:** il contorno della lettera col pennarello grosso sborda e impasta; il
  tratto sta **dentro** la lettera, a metà larghezza di penna dal bordo, con almeno ~0,9 mm d'aria fra
  le lettere (`magneti/testo_marker.py`). Ricavato dai file ritoccati a mano dall'utente.
- **Il controllo** (`controlla.py`) segnala: disegno fuori dal foglio o nel margine, tratti più corti di
  0,15 mm, livelli molto sovrapposti (>1,8×: le linee si impastano). Legge anche i file salvati dallo
  SLICER, con lo **spessore vero** dei livelli.
- **Niente logo GDC** nei lavori, salvo richiesta: lo aggiunge l'utente dallo SLICER.

## Strumenti

| File | A che serve |
|---|---|
| `lavoro.py` | punto d'ingresso: legge la scheda, sceglie il motore, aggiunge i testi, controlla |
| `controlla.py` | controllo di un SVG (`python3 -B controlla.py file.svg [W H margine]`) |
| `strumento/strumento.py`, `strumento/template.html` | la pagina e il piccolo server che lancia `lavoro.py` |
| `catalogo.py` | genera `catalogo/index.html` (anteprime apribili in grande, zoom) dai file consegnati; gli esempi nuovi stanno in `catalogo/esempi/`, ognuno con la sua `scheda.json` |
| `rilievo.py` (+ `portaoggetti-feffi/viste.py`) | motore di Rilievo e Layer da modello 3D: `profondita` = Rilievo (curve organiche), `quota` = Layer (fette parallele); passo come `L<n>` = n livelli |
| `render_ombra.py` + `da_immagine.py` | Rilievo dettagliato da 3D (render ombreggiato → curve di luminosità + tratti scuri) e Rilievo da screenshot |
| `anteprima_viste.py` | foglio di anteprime da più viste, per scegliere da dove guardare un modello |
| `foto_onde.py`, `foto_poligoni.py`, `foto_tratti.py` | Onde, Poligoni, Tratti da foto (`foto_tratti.py` ha le funzioni di base: persone, contrasto locale) |
| `linea.py` (+ `magneti/vettorializza.py`) | Linea da illustrazione/logo, due penne |
| `fedele.py` (+ `logo_vettoriale.py`) | Fedele: contorni delle campiture, anche a più colori (`colori=N`) e con riempimento a tratteggio |
| `magneti/testo_marker.py`, `magneti/piccoli_e_bianchi.py` | scritte per l'indelebile; i magneti piccoli e bianchi |
| `logo_vettoriale.py` | primo motore del logo Antei a contorni; `fedele.py` ne riusa il tratteggio |
| `testo.js` | scritte col font a tratto singolo |
| `penne.json` | colore e spessore di anteprima di ogni penna |

I motori sono rimasti dove erano: `lavoro.py` li chiama, non li sostituisce.

## Cartelle dei lavori

`portaoggetti-feffi/` (biglietto, `finale/` = file ritoccato dall'utente) · `antei/` (logo e due mascotte,
cinque file definitivi) · `magneti/` (lavagna d'allenamento, `finali-utente/` = file buoni) ·
`foto-coppia/` (foto in tre stili) · `palla-beach-volley.svg`.

## Da fare

- Quando tutto è definito: **skill** richiamabile che fa il modulo e lancia `lavoro.py`.
- Per **Linea** la scheda chiede ancora a mano dove finisce la grafica e inizia la scritta (`testo`).
- Un modello 3D con più oggetti grandi: `lavoro.py` usa il più grande e avvisa; si sceglie con `oggetto`.
- I testi stanno solo sotto al disegno.
