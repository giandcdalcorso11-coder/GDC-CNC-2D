/* IL TELECOMANDO DELLA MACCHINA — MKR IoT Carrier Rev2 + MKR WiFi 1010
 * =====================================================================
 *
 * Dice che cosa sta facendo la stampa e lascia chiudere il cambio penna
 * stando ALLA MACCHINA, con le mani sulla penna, invece che tornando al
 * portatile. Il progetto per esteso sta in `schermo/README.md`; qui c'è
 * quello che serve per leggere il codice.
 *
 * LA REGOLA, CHE È STRUTTURA E NON DISCIPLINA.
 * Questo coso NON PARLA CON LA MACCHINA. Non conosce l'indirizzo di
 * FluidNC, non ha un client HTTP, non apre connessioni: è un SERVER e
 * basta. Chi chiama è sempre il SLICER, dal browser, con un POST. Quindi
 * «il telecomando non può comandare FluidNC» non è una promessa: non ha
 * con che cosa.
 *
 * UN CANALE SOLO, IN DUE VERSI.
 * Un browser non apre socket TCP, quindi il verso è obbligato: il SLICER
 * manda lo stato, e LA RISPOSTA A QUEL POST riporta indietro il tasto
 * premuto e la carica della batteria. Nessuna seconda connessione.
 *
 *   POST /stato  { v, stato, nome, percento, rimanente, penna, passo, giu,
 *                  macchina, azzerata, data }
 *     → 200      { "tasto": "riprendi", "batteria": 78, "carica": "carica" }
 *
 * `tasto` è quello premuto da quando è arrivato il messaggio precedente,
 * e si consuma: una pressione, un messaggio, una volta sola.
 *
 * PERCHÉ IL TELECOMANDO NON SA NIENTE DA SOLO.
 * La stampa non è un file che la macchina esegue: è il browser che manda
 * una riga alla volta e conta gli «ok». Percentuale, tempo rimanente,
 * cambi penna, errori e colore della penna vivono dentro alla pagina e da
 * nessun'altra parte. Quindi qui non c'è niente da andare a prendere: si
 * aspetta che arrivino. Se non arrivano — portatile chiuso, pagina
 * ricaricata — dopo sei secondi lo schermo lo dice, invece di mostrare
 * numeri vecchi che sembrano freschi.
 *
 * COME SI CARICA
 * 1. Riempi `arduino_secrets.h` con la tua rete (2,4 GHz: il MKR non fa
 *    i 5 GHz), la stessa del portatile.
 * 2. Gestore librerie: «Arduino MKRIoTCarrier» 2.0.0 o successiva, che
 *    si tira dietro tutto il resto; «WiFiNINA» se non c'è già.
 * 3. Scheda: Arduino MKR WiFi 1010. Carica.
 * 4. All'accensione il vetro scrive il proprio INDIRIZZO IP: quello va
 *    copiato nelle impostazioni del SLICER. Senza, il SLICER non sa a
 *    chi parlare.
 */

#include <Arduino_MKRIoTCarrier.h>
#include <Wire.h>
#include <WiFiNINA.h>
#include <SD.h>
#include "arduino_secrets.h"

MKRIoTCarrier carrier;
WiFiServer server(80);

/* ===================================================================
 * I TIPI, TUTTI QUI IN CIMA
 *
 * Non è gusto di ordine: l'IDE di Arduino genera da sé i prototipi di
 * tutte le funzioni del file e li infila PRIMA della prima funzione. Un
 * tipo dichiarato più in basso viene nominato da quei prototipi quando
 * ancora non esiste, e il compilatore si ferma su righe che a guardarle
 * sembrano giuste. Quindi: prima i tipi, poi tutto il resto.
 * =================================================================== */

struct Stato {
  /* LARGO QUANTO LA PAROLA PIU' LUNGA, PIU' UN PO'. Con 10 byte ci stava
     «interrotta» meno una lettera: il parser tronca in silenzio, e poi
     nessun confronto torna piu' — lo stato nuovo semplicemente non
     esisteva, senza un errore da nessuna parte. Trovato dal banco, che
     compila con i controlli sui buffer accesi. */
  char  stato[12];      // fermo | invio | pausa | cambio | fine | fermata | errore
  int   percento;       // 0..100, -1 = non c'è
  long  rimanente;      // millisecondi, -1 = il Sender non l'ha ancora misurato
  char  penna[10];      // "#rrggbb", vuoto = il livello non ha una tinta
  char  nome[28];       // il nome del lavoro: serve solo al libro di bordo
  int   passo;          // 0 o 1 nel cambio penna, -1 fuori
  int   giu;            // 1 penna al contatto, 0 alzata, -1 il SLICER non lo dice
  /* SU CHE FOGLIO STA DISEGNANDO, quando i fogli sono piu' d'uno. Zero
     vuol dire «il SLICER non lo dice»: un foglio solo, oppure un programma
     scritto prima del 2026-11-07, che il marcatore non ce l'ha. Senza
     questo, con nove magneti sul piano si vedrebbe una percentuale salire
     senza sapere se il terzo e' fatto o se si sta ancora al primo -- e con
     l'ordine per penna la punta ci torna sopra due volte. */
  int   foglioN;        // 1..foglioDi, 0 = non lo dice
  int   foglioDi;       // quanti fogli in tutto, 0 = non lo dice
  char  macchina[8];    // Idle | Run | Jog | Hold | Alarm
  bool  azzerata;
  char  data[26];       // la manda il SLICER: qui un orologio non c'è
};

Stato S;
unsigned long ultimoMessaggio = 0;    // millis() dell'ultimo POST servito
bool mai = true;                      // non è ancora arrivato niente

/* Sei secondi di silenzio e lo schermo lo dice. Sono quindici battiti
   mancati durante una stampa (il SLICER chiama ogni 400 ms) e tre a
   riposo: abbastanza da non lampeggiare per un pacchetto perso. */
const unsigned long SCADENZA = 6000;

/* `NESSUNA` non è una schermata: vuol dire «quello che c'è sul vetro non
   vale più, rifallo». Sta dentro all'elenco invece di essere un -1 buttato
   lì perché un valore fuori dall'intervallo di un enum, in C++, è
   ufficialmente non definito: funziona finché funziona. */
enum Schermata { PRONTA, STAMPA, IN_PAUSA, PENNA1, PENNA2, PENNA3,
                 STOP_ARMATO, STOP_TIENI, FERMANDO, FERMATA,
                 FINE, ERRORE, ATTESA, NESSUNA };

enum Posto { BASSO, ALTO_SX, ALTO_DX, BASSO_SX, BASSO_DX, NESSUNO };

/* Che cosa dice il caricabatterie della spina. `FERMA` non è un doppione
   di `A_BATTERIA`: vuol dire che la corrente c'è e la cella NON sta
   caricando, che è il guasto da far vedere invece di nasconderlo. */
enum Spina { A_BATTERIA, IN_CARICA, PIENA, FERMA };

/* `sotto` è la SECONDA RIGA, quando una parola sola non basta a dire che
   cosa fa il tasto. Sta in fondo apposta: le etichette di una riga si
   scrivono come prima e il campo resta vuoto da sé. */
/* `chiude` e' il terzo mestiere che un tasto puo' fare, dopo «manda una
   parola al SLICER» e «arma lo stop»: chiudere il racconto di fine stampa
   senza mandare niente a nessuno. Sta in fondo alla struttura apposta —
   i tasti scritti prima del 2026-11-09 non lo nominano e lo prendono
   `false` da se', che e' quello che facevano gia'. */
struct Tasto { Posto dove; const char* parola; uint16_t colore;
               const char* manda; const char* sotto; bool chiude; };
const int MAX_TASTI = 2;

struct Nota { int hz; int ms; };    // hz = 0: silenzio

/* Da qui in giù cominciano le funzioni: sopra ci sono solo tipi e
   variabili, e questa è la prima. I prototipi che l'IDE genera finiscono
   proprio qui sopra, dove ormai i tipi esistono. */
bool vivo() { return !mai && millis() - ultimoMessaggio < SCADENZA; }


/* ===================================================================
 * I COLORI
 *
 * Gli stessi del banco di prova (`schermo/mock.html`), convertiti in
 * RGB565, che è come il pannello li vuole: 5 bit di rosso, 6 di verde,
 * 5 di blu. Il verde ha un bit in più perché l'occhio lo distingue
 * meglio, non per simpatia.
 * =================================================================== */
#define COL(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

const uint16_t NERO     = 0x0000;
const uint16_t TESTO    = COL(0xE6, 0xEA, 0xF0);
const uint16_t SMORTO   = COL(0x97, 0xA1, 0xB0);
const uint16_t FIOCO    = COL(0x6B, 0x76, 0x86);
const uint16_t BLU      = COL(0x4C, 0x9A, 0xFF);
const uint16_t ROSSO    = COL(0xE0, 0x52, 0x52);
const uint16_t AMBRA    = COL(0xE0, 0xA6, 0x3A);
const uint16_t VERDE    = COL(0x43, 0xB5, 0x81);
const uint16_t SPENTO   = COL(0x23, 0x29, 0x35);   // l'anello quando non dice niente

/* ===================================================================
 * LA GEOMETRIA DEL VETRO
 *
 * 240 × 240 px su 33 mm di vetro: UN DECIMO DI MILLIMETRO PER PIXEL. Una
 * riga alta 24 px è alta tre millimetri e tre decimi. Nel tondo ci stanno
 * un simbolo, un numero e due parole, e basta.
 *
 * E lo spazio utile è un CERCHIO, non un rettangolo: dentro ci sta
 * l'anello (raggio 101, spesso 11, quindi il bordo interno è a 95,5), e
 * alle parole restano i 93 pixel di raggio più interni.
 *
 * NON C'È UN BUFFER. Una pagina video 240 × 240 a 16 bit vuole 115 kB e
 * il MKR WiFi 1010 ne ha 32 in tutto. Si disegna direttamente sul vetro,
 * una forma alla volta, e per questo si ridisegna solo quello che è
 * cambiato: cancellare e rifare tutto a ogni messaggio sarebbe uno
 * sfarfallio continuo.
 * =================================================================== */
const int CX = 120, CY = 120;
const float R_INT = 95.5, R_EST = 106.5;   // l'anello
const float R_TESTI = 93.0;                // da qui in dentro: parole

/* Il font di Adafruit_GFX è 6 × 8 px, moltiplicato per il corpo. È più
   LARGO di un font da schermo: le parole del banco di prova sono state
   accorciate per questo — «PAUSA» invece di «IN PAUSA» — e non per
   ripensamento. */
int largo(const char* s, int k) { return (int)strlen(s) * 6 * k - k; }
int alto(int k)                 { return 8 * k; }

/* ===================================================================
 * QUELLO CHE ARRIVA DAL SLICER
 * =================================================================== */
/* ===================================================================
 * LE SCHERMATE
 * =================================================================== */
Schermata schermoOra = ATTESA;
Schermata schermoDisegnato = NESSUNA;

/* Lo stop si conferma in due tempi, e i due tempi sono roba NOSTRA: al
   SLICER arriva un «stop» solo, già confermato. Il primo tocco chiede e
   basta — un pad capacitivo sfiorato da una manica non deve buttare via
   venti minuti di disegno — il secondo si tiene premuto un secondo. */
const unsigned long ARMATO_MS = 4000;   // quanto resta in piedi la domanda
const unsigned long TENUTA_MS = 1000;   // quanto va tenuto il secondo tocco
unsigned long armatoDa = 0;
unsigned long tenutoDa = 0;
bool armato = false, tenendo = false;
/* IL DITO CHE HA ARMATO È ANCORA SUL PAD. Senza questo, il secondo tempo
   comincerebbe a contare nello stesso istante del primo e i due tempi
   diventerebbero uno solo: «tocca e tieni» invece di «tocca, poi tieni».
   Che è esattamente la sicurezza che si voleva. */
bool attesaRilascio = false;

/* ===================================================================
 * LO STOP CHIESTO, E IL RACCONTO CHE SCADE
 *
 * DOPO LO STOP IL VETRO TORNAVA A «STAMPA». Tenuto il dito il secondo
 * necessario, il telecomando manda «stop» — ma lo manda nella RISPOSTA al
 * prossimo messaggio, il SLICER lo legge, ferma, e solo col messaggio
 * DOPO torna indietro lo stato nuovo. Due giri. In quei due giri
 * `S.stato` vale ancora «invio», e la schermata che si disegna e' quella
 * della stampa in corso: anello, percentuale, tutto. Si vedeva come uno
 * sfarfallio fra tre schermate — tieni, stampa, pronta — ed e' quello che
 * l'utente ha visto il 2026-11-02 tenendo il dito sul tasto.
 *
 * Il rimedio non e' accelerare i messaggi: e' smettere di mentire. Da
 * quando lo stop parte a quando lo stato cambia, il vetro dice FERMANDO.
 * Con una scadenza, pero': se il comando si perde per strada, una
 * schermata che resta li' per sempre e' peggio di uno sfarfallio.
 *
 * E IL RACCONTO SCADE. «Fatta» e «fermata» restano finche' non parte la
 * stampa dopo: va bene per dieci minuti, non per la mattina dopo, quando
 * il telecomando racconta ancora ieri a chi passa. Dopo tre minuti si
 * torna a Pronta — il fatto e' nel registro del SLICER, non sul vetro.
 * =================================================================== */
const unsigned long FERMANDO_MS = 6000;     // oltre, il comando s'e' perso
const unsigned long RACCONTO_MS = 180000;   // tre minuti, poi si torna Pronta
unsigned long fermandoDa = 0;
unsigned long raccontaDa = 0;

bool fermando() {
  if (!fermandoDa) return false;
  if (millis() - fermandoDa > FERMANDO_MS) { fermandoDa = 0; return false; }
  return true;
}

bool raccontoScaduto() {
  return raccontaDa && (millis() - raccontaDa > RACCONTO_MS);
}

/* E IL RACCONTO SI PUO' CHIUDERE A MANO, dal 2026-11-09, chiesto
 * dall'operatore: «poter cliccare uno dei pulsanti dopo la fine o
 * l'annullamento della stampa per tornare alla schermata base».
 *
 * I tre minuti restano, e non sono in concorrenza: la scadenza serve a chi
 * passa la mattina dopo e trova il vetro che racconta ieri, il tasto serve
 * a chi e' li' davanti, ha letto, e vuole il telecomando pronto adesso.
 * Due modi di arrivare allo stesso posto, uno per il tempo e uno per le
 * dita.
 *
 * E' una variabile e non un `raccontaDa = 0`, che sarebbe stato piu'
 * corto: azzerare l'orologio vorrebbe dire anche dimenticare QUANDO la
 * stampa e' finita, e quel momento serve a `raccontoScaduto()` — se poi
 * arriva un altro messaggio con lo stesso stato «fine», senza l'orologio
 * il racconto ricomincerebbe da capo. Si rimette a `false` al primo
 * cambio di stato: vedi dove si scrive `raccontaDa`. */
bool raccontoChiuso = false;

bool raccontoFinito() { return raccontoChiuso || raccontoScaduto(); }

Schermata quale() {
  if (armato)  return tenendo ? STOP_TIENI : STOP_ARMATO;
  if (!vivo()) return ATTESA;
  /* PRIMA DI TUTTO QUELLO CHE DICE IL SLICER. Lo stop e' partito e la
     risposta non e' ancora tornata: per due giri di messaggi `S.stato` vale
     ancora «invio», e mettere qui la schermata della stampa vorrebbe dire
     rimetterla DOPO che l'hai fermata. E' tutto il motivo per cui questa
     riga esiste, quindi sta sopra alle altre. */
  if (fermando()) return FERMANDO;
  if (!strcmp(S.stato, "invio"))  return STAMPA;
  if (!strcmp(S.stato, "pausa"))  return IN_PAUSA;
  /* TRE PASSI E NON PIU' DUE, dal 2026-11-03: dopo aver montato la penna
     nuova si va a ritrovarne la PUNTA, che non sta dove stava quella di
     prima. Senza questa riga il vetro continuerebbe a dire «MONTA» mentre
     lo slicer chiede di andare sull'angolo del foglio: una schermata che
     dice una cosa e una macchina che ne aspetta un'altra. */
  if (!strcmp(S.stato, "cambio")) {
    if (S.passo >= 2) return PENNA3;
    return S.passo >= 1 ? PENNA2 : PENNA1;
  }
  if (!strcmp(S.stato, "fermata")) return raccontoFinito() ? PRONTA : FERMATA;
  if (!strcmp(S.stato, "fine"))       return raccontoFinito() ? PRONTA : FINE;
  if (!strcmp(S.stato, "errore")) return ERRORE;
  return PRONTA;
}

/* ===================================================================
 * I CINQUE TASTI, DOVE SONO DAVVERO
 *
 * Stanno a 60° uno dall'altro — cinque posti su sei — e IL VUOTO E' IN
 * ALTO, dove sulla scheda ci sono i sensori. Girando in senso orario a
 * partire da destra: 00 in alto a destra, 01 in basso a destra, 02 IN
 * BASSO, 03 in basso a sinistra, 04 in alto a sinistra. Il LED n sta
 * accanto al pad n.
 *
 * QUESTA TABELLA ERA RUOTATA DI MEZZO GIRO, ed è il difetto visto alla
 * prima prova sul banco il 2026-10-31: le parole comparivano da una
 * parte del vetro e si accendeva il LED dalla parte opposta. Veniva da
 * una lettura degli schemi Altium — i pad stanno sul rame di SOTTO, e di
 * sotto destra e sinistra, alto e basso, sono il contrario — presa per
 * buona senza il controllo che costava dieci secondi: premere un pad con
 * la scheda in mano e guardare quale LED si accende.
 *
 * Il modo di ricontrollarla resta quello: si preme, si guarda. Se un
 * giorno il vetro venisse montato girato, qui dentro si gira di
 * conseguenza — e nient'altro va toccato, perché tutto il resto parla di
 * POSTI e non di numeri di pad.
 * =================================================================== */
touchButtons padDi(Posto p) {
  switch (p) {
    case ALTO_DX:  return TOUCH0;
    case BASSO_DX: return TOUCH1;
    case BASSO:    return TOUCH2;
    case BASSO_SX: return TOUCH3;
    default:       return TOUCH4;   // ALTO_SX
  }
}

/* Che cosa fa ogni pad IN QUESTA schermata. Un tasto che non fa niente
   non ha etichetta e ha il LED spento: non per risparmiare, ma perché
   premerlo non farebbe niente, e un tasto che a volte non fa niente
   senza dirlo insegna a non fidarsi dei tasti. */
int tastiDi(Schermata s, Tasto* out) {
  switch (s) {
    case STAMPA:
      out[0] = { ALTO_SX,  "PAUSA",    BLU,   "pausa" };
      out[1] = { BASSO_DX, "STOP",     ROSSO, "" };      // "" = lo stop lo arma qui
      return 2;
    case IN_PAUSA:
      out[0] = { ALTO_SX,  "RIPRENDI", BLU,   "riprendi" };
      out[1] = { BASSO_DX, "STOP",     ROSSO, "" };
      return 2;
    case PENNA1:
      out[0] = { BASSO,    "FATTO",    AMBRA, "avanti" };
      return 1;
    case PENNA2:
      out[0] = { BASSO,    "RIPRENDI", AMBRA, "riprendi" };
      /* Si chiamava PROVA e non si capiva: «prova» è anche il nome della
         prova in bianco, e la parola non dice che cosa succede. Adesso lo
         dice. Il comando che va al SLICER resta `prova`: è il protocollo,
         e cambiarlo vorrebbe dire cambiare le due parti insieme per
         guadagnare niente. */
      /* E LA PAROLA DICE L'AZIONE, non il nome del tasto. «ABBASSA E ALZA»
         costringeva a guardare la macchina per sapere che cosa sarebbe
         successo premendo: adesso c'è scritto «ALZA» quando la penna è al
         contatto e «ABBASSA» quando è su, e la parola cambia appena il
         servo si muove. Dove sta il servo lo sa il SLICER, che lo manda nel
         messaggio (`giu`); quando non lo dice — un SLICER vecchio — si parte
         da «ALZA», perché entrando nel montaggio il servo è al contatto, e
         al primo messaggio la parola si corregge da sé. */
      out[1] = { BASSO_DX, S.giu == 0 ? "ABBASSA" : "ALZA", VERDE, "prova" };
      return 2;
    /* NIENTE TASTI, ed e' una scelta. Ritrovare la punta vuol dire guidare
       la testina col tastierino e GUARDARE dove cade: si fa davanti alla
       macchina, con lo slicer sotto gli occhi. Un tasto «FATTO» qui sopra
       sarebbe premibile senza aver mosso niente, cioe' un modo di spostare
       il programma di venti millimetri per sbaglio. Quando il passo sara'
       portato sul telecomando ci vorranno le frecce, non un tasto solo. */
    case PENNA3:
      return 0;
    case STOP_ARMATO:
      out[0] = { BASSO,    "ANNULLA",  VERDE, "" };
      out[1] = { BASSO_DX, "TIENI",    ROSSO, "" };
      return 2;
    case STOP_TIENI:
      out[0] = { BASSO_DX, "TIENI",    ROSSO, "" };
      return 1;
    /* LE DUE SCHERMATE DI FINE HANNO UN TASTO SOLO, e sta IN ALTO A
       SINISTRA e non in basso al centro come gli altri «fatto» di questo
       telecomando. Il motivo e' che in basso, qui, c'e' gia' roba: su
       FERMATA la percentuale a cui la stampa si e' interrotta (y 158) e su
       tutt'e due la pila rossa sotto il 20% (y 196). Un'etichetta in basso
       al centro cadrebbe sopra l'una o sopra l'altra — cioe' coprirebbe
       l'unico numero per cui quella schermata esiste.
       Il colore e' BLU come PAUSA e RIPRENDI: e' un'azione che non tocca
       la macchina, e il verde e il rosso qui vogliono dire altro.
       E LA PAROLA E' CORTA PER FORZA: «CHIUDI» larga settanta pixel
       arrivava a x 110, e li' comincia il simbolo — il cerchio del
       divieto sta da 96 a 144, la spunta da 98. Due lettere ci stanno
       senza toccare niente, e su una schermata che dice gia' FATTO o
       FERMATA al 43%, «OK» non ha bisogno di spiegare altro. Il
       controllo della geometria (`schermo/vetro/geometria.py`) adesso
       conosce i simboli e la pila, quindi questa collisione la trova da
       se': l'ha trovata davvero, due volte, mentre si sceglieva dove
       mettere questo tasto. */
    case FINE:
    case FERMATA:
      out[0] = { ALTO_SX, "OK", BLU, "", "", true };
      return 1;
    default:
      return 0;   // Pronta, Errore, In attesa: nessun tasto vivo
  }
}

/* Il tasto premuto, in attesa che il SLICER venga a prenderselo. Uno
   solo: due pressioni fra due messaggi vogliono dire che la seconda è
   partita senza vedere l'effetto della prima, e in quel caso vale la
   prima. */
char daMandare[10] = "";
void manda(const char* t) { if (!daMandare[0]) strncpy(daMandare, t, sizeof(daMandare) - 1); }

/* ===================================================================
 * I SUONI
 *
 * Il cicalino M1 è un ABT-461-RC: un trasduttore magnetico A COMANDO
 * ESTERNO. Non ha l'oscillatore dentro, quindi non suona perché gli dai
 * tensione — suona finché gli fai commutare il piedino. E NON HA VOLUME:
 * o commuta o non commuta. L'unica cosa che cambia quanto si sente è la
 * frequenza, perché ha una RISONANZA.
 *
 * Per questo i due allarmi — cambio penna e problema — stanno su UNA
 * NOTA SOLA, quella della risonanza, e si distinguono per il RITMO: due
 * colpi contro uno lungo. È una differenza che regge anche quando il
 * suono arriva attutito da una porta, mentre due altezze diverse,
 * attutite, diventano la stessa cosa. Partenza e fine le senti da vicino
 * e possono permettersi delle note, tutte dentro l'ottava in cui il coso
 * parla.
 *
 * RISONANZA MISURATA: 2500 Hz, il 2026-11-02, con un torneo a due note
 * per volta (`cicalino/cicalino.ino`). Prima c'era scritto 4000, che era
 * un numero messo a caso: quasi mezza ottava fuori, cioè il cicalino
 * gridava col freno tirato da sempre.
 *
 * E 2500 NON È SOLO UNA COSTANTE: È LA TONICA. Le note qui sotto non sono
 * trasportate a caso — sono una scala maggiore con il DO su 2500, che è
 * la nota più forte che questo cicalino sappia fare:
 *
 *     sol 1873   la 2102   si 2360   DO 2500   re 2806   mi 3150   fa 3338
 *
 * Più si va lontano da 2500 più il suono si spegne, quindi la scala è
 * tutta quella che c'è: nove semitoni. Le melodie finiscono sul DO perché
 * l'ultima nota è quella che deve arrivare.
 *
 * Attenzione a una cosa che il commento vecchio prometteva e il codice non
 * ha mai fatto: `RISONANZA` NON trascina le melodie. Le note sono scritte
 * a mano qui sotto, e `RISONANZA` la usa soltanto il tic di otto
 * millisecondi quando si tocca un pad. Cambiare un numero solo non basta:
 * si rifà la scala e si riscrivono i quattro suoni (il banco dei suoni,
 * `schermo/suoni.html`, li fa sentire prima di caricarli).
 * =================================================================== */
const int RISONANZA = 2500;

/* Scelti all'ascolto dall'utente sul banco dei suoni, il 2026-11-02.

   PARTENZA — «la fanfara»: sol do mi, do mi, do. Una quarta, una terza e
   il rimbalzo: è la forma delle trombe militari, e quella forma esiste
   per un motivo che vale anche qui — usa SOLO le note che uno strumento
   senza tasti sa fare, e il cicalino è esattamente uno strumento senza
   tasti. Il sol d'attacco sta un quarto sotto il DO, quindi è la nota più
   debole delle sei: va bene perché è la spinta, non l'arrivo, e la
   partenza la senti da vicino.

   CAMBIO PENNA — «tre colpi»: tutto sul DO, perché attutito da una porta
   le altezze diventano uguali e quello che sopravvive è il ritmo. Tre è
   un numero che si conta anche attutito.

   FINE — «l'arpeggio che torna»: sale, tocca il tetto, e rifà la strada
   all'indietro fino al DO tenuto. Un arco che si richiude si sente come
   finito; un salto si sente come interrotto.

   PROBLEMA — «la sirena»: due note che si alternano, il motivo delle
   ambulanze. Scelta con un rischio noto e accettato: attutita diventa una
   fila di cinque colpi, e cinque somigliano a tre. Quello che la salva è
   che TORNA OGNI DIECI SECONDI contro i venti del cambio penna — vedi
   «IL RICHIAMO». */
const Nota SUONO_PARTENZA[] = { {1873, 90}, {2500, 90}, {3150, 140},
                                {2500, 90}, {3150, 90}, {2500, 260} };
const Nota SUONO_PENNA[]    = { {2500, 90}, {0, 70}, {2500, 90},
                                {0, 70}, {2500, 90} };
const Nota SUONO_FINE[]     = { {2227, 65}, {2500, 65}, {2806, 65},
                                {3150, 120}, {2806, 65}, {2500, 300} };
const Nota SUONO_ERRORE[]   = { {2500, 120}, {2973, 120}, {2500, 120},
                                {2973, 120}, {2500, 160} };

/* FERMATA — due note che scendono, e basta. Non e' un allarme: l'hai
   fermata tu, e un suono che insiste direbbe che e' successo qualcosa.
   Non e' nemmeno la fine: niente e' stato portato a termine, quindi niente
   arpeggio che si richiude. Scendere e fermarsi dice «ho smesso». E la
   sagoma — due note sole — non somiglia ne' ai tre colpi del cambio penna
   ne' alla sirena del problema, che e' il criterio di tutti i suoni qui. */
const Nota SUONO_STOP[]     = { {3150, 110}, {2500, 240} };

/* ===================================================================
 * IL VOLUME, CHE SU QUESTO CICALINO NON ESISTE
 *
 * L'ABT-461-RC e' un trasduttore a comando esterno: o commuta o non
 * commuta. Non c'e' nessun livello da abbassare, nessun partitore, nessun
 * amplificatore — fra il piedino e la bobina c'e' un solo MOSFET che apre
 * e chiude. Quindi «volume» qui vuol dire una cosa sola: QUANTO DURA
 * L'IMPULSO dentro a ogni periodo.
 *
 * E non va in proporzione. Quello che la membrana sente e' l'ampiezza
 * della prima armonica dell'onda, che per un impulso lungo una frazione d
 * del periodo vale sin(pi * d): a meta' periodo — l'onda quadra — e' il
 * massimo; a un ventesimo e' un sesto. Per questo la scala del SLICER ha
 * DIECI tacche e non cento, e per questo la nota sotto al cursore dice i
 * decibel invece di una percentuale: da 10 a 9 non si sente quasi, da 2 a
 * 1 si sente moltissimo.
 *
 * DUE STRADE, E SI SCEGLIE UNA SOLA VOLTA PER NOTA.
 *   volume 10  ->  `tone()`, cioe' ESATTAMENTE quello che il firmware
 *                  faceva prima che questo cursore esistesse. Il piedino
 *                  lo commuta un'interruzione del core, e il piedino e'
 *                  un'uscita normale.
 *   volume 1-9 ->  TCC0 in PWM: il periodo lo decide la nota, la parte
 *                  alta il volume, e il piedino lo pilota il timer.
 *
 * Non si mescolano: le due strade vogliono il piedino in due modi diversi
 * (uscita normale contro uscita del timer), e passare dall'una all'altra
 * vuol dire rifare il collegamento interno. Lo si fa quando il volume
 * attraversa il dieci, non a ogni nota.
 *
 * PERCHE' TCC0 E PERCHE' SI PUO'. Il cicalino sta su D7, che e' PA21, che
 * e' il canale 7 di TCC0 (tabella della variante mkrwifi1010). TCC0 qui
 * non lo usa nessun altro: la retroilluminazione del vetro sta su D3, che
 * e' TCC1, e `tone()` usa TC5. L'unico altro piedino di TCC0 e' D6, che
 * sul carrier non va da nessuna parte.
 *
 * E L'IMPIANTO LO FA IL CORE, non noi: `analogWrite(BUZZER, 0)` collega il
 * piedino al timer, accende il clock e mette TCC0 in PWM — codice
 * collaudato da anni. Di nostro restano DUE registri, il periodo e il
 * confronto. Scrivere a mano anche il resto sarebbe stato piu' codice e
 * piu' modi di sbagliare, per la stessa cosa.
 *
 * QUESTA PARTE NON E' STATA PROVATA SULLA SCHEDA: da qui dentro il
 * firmware non si compila per il MKR (downloads.arduino.cc e' bloccato).
 * Il dieci pero' e' la strada vecchia, intatta: se il PWM fosse sbagliato,
 * il telecomando a volume pieno suona come prima e si sbaglia solo sotto.
 * =================================================================== */
const uint8_t BUZZER_PIN = 7;        // D7 = PA21 = TCC0/WO[7]
int volumeCicalino = 10;             // 0 muto, 10 pieno. Lo manda il SLICER.
int modoCicalino = 0;                // 0 niente, 1 tone(), 2 PWM

static void sincroTCC0() { while (TCC0->SYNCBUSY.reg) { /* aspetta */ } }

void taci() {
  if (modoCicalino == 2) {
    TCC0->CC[7].reg = 0;
    sincroTCC0();
  } else {
    carrier.Buzzer.noSound();
  }
}

void canta(int hz) {
  if (hz <= 0 || volumeCicalino <= 0) { taci(); return; }

  if (volumeCicalino >= 10) {
    if (modoCicalino != 1) {
      /* Il piedino torna un'uscita normale: `pinMode` rifa' il
         collegamento interno, che il PWM aveva spostato sul timer. */
      pinMode(BUZZER_PIN, OUTPUT);
      modoCicalino = 1;
    }
    carrier.Buzzer.sound(hz);
    return;
  }

  if (modoCicalino != 2) {
    carrier.Buzzer.noSound();
    analogWrite(BUZZER_PIN, 0);      // il core collega, accende e configura
    modoCicalino = 2;
  }
  uint32_t per = (uint32_t)(F_CPU / (uint32_t)hz) - 1;
  /* Dieci tacche su un massimo di mezzo periodo: la tacca 9 e' il 45% e la
     tacca 1 il 5%. Oltre meta' periodo non si guadagna niente — l'onda e'
     simmetrica e la prima armonica ricomincia a calare. */
  uint32_t alto = (per + 1) * (uint32_t)volumeCicalino / 20;
  if (alto < 1) alto = 1;
  TCC0->PER.reg = per;
  sincroTCC0();
  TCC0->CC[7].reg = alto;
  sincroTCC0();
}

const Nota* inSuono = nullptr;
int quanteNote = 0, notaOra = 0;
unsigned long notaDa = 0;

void suona(const Nota* s, int n) { inSuono = s; quanteNote = n; notaOra = -1; notaDa = 0; }
#define SUONA(x) suona(x, sizeof(x) / sizeof(Nota))

/* Il suono avanza da sé, un pezzo per giro: `delay()` qui dentro vuol
   dire un tasto che non risponde mentre il cicalino canta. */
void suoni() {
  if (!inSuono) return;
  unsigned long ora = millis();
  if (notaOra >= 0 && ora - notaDa < (unsigned long)inSuono[notaOra].ms) return;
  notaOra++;
  if (notaOra >= quanteNote) { taci(); inSuono = nullptr; return; }
  notaDa = ora;
  if (inSuono[notaOra].hz) canta(inSuono[notaOra].hz);
  else                     taci();
}

/* ===================================================================
 * IL RICHIAMO
 *
 * Due suoni si ripetono, e non per lo stesso motivo. Il CAMBIO PENNA si
 * ripete perché la macchina sta ASPETTANDO TE: uno squillo solo la
 * lascerebbe ferma un'ora se in quel momento eri in un'altra stanza, e
 * quindi chiama finché non vieni. Il PROBLEMA si ripete perché la
 * macchina si è FERMATA e non lo sa nessuno.
 *
 * LE DUE CADENZE SONO DIVERSE, E QUELLA È LA DIFFERENZA CHE SOPRAVVIVE.
 * I tre colpi del cambio penna e la sirena del problema, attutiti da una
 * porta, si somigliano: la sirena diventa una fila di cinque colpi e
 * cinque somigliano a tre. Ma uno torna ogni DIECI secondi e l'altro ogni
 * VENTI, e un ritmo lento si conta anche quando quello veloce non si
 * distingue più. La cadenza dice quello che la sagoma non riesce a dire.
 *
 * E IL PROBLEMA NON CHIAMA PER SEMPRE: tre minuti, diciotto sirene. Se
 * non sei arrivato in tre minuti non sei in casa; la macchina è ferma e
 * non si sta rovinando niente, e la schermata rossa continua a dirlo a
 * chi arriva. Il cambio penna invece non ha scadenza, perché lì ogni
 * minuto di silenzio è un minuto di macchina sprecato.
 * =================================================================== */
const unsigned long RICHIAMO_PENNA  = 20000;
const unsigned long RICHIAMO_ERRORE = 10000;
const unsigned long ALLARME_PER     = 180000;   // 0 = per sempre

const Nota* richiamo = nullptr;
int richiamoQuante = 0;
unsigned long richiamoOgni = 0, ultimoRichiamo = 0, richiamoFino = 0;
char richiamoStato[10] = "";

void armaRichiamo(const Nota* x, int n, unsigned long ogni, unsigned long per) {
  richiamo = x; richiamoQuante = n; richiamoOgni = ogni;
  ultimoRichiamo = millis();
  richiamoFino = per ? millis() + per : 0;
  strncpy(richiamoStato, S.stato, sizeof(richiamoStato) - 1);
  richiamoStato[sizeof(richiamoStato) - 1] = 0;
}
void fermaRichiamo() { richiamo = nullptr; richiamoStato[0] = 0; }
#define ARMA(x, ogni, per) armaRichiamo(x, sizeof(x) / sizeof(Nota), ogni, per)

/* Sta in una funzione sua e non dentro al giro perché il banco di prova la
   chiama da fuori: una sirena che non smette, o che non parte, è il tipo
   di difetto che non si vede guardando il codice. */
void richiama() {
  if (!richiamo || strcmp(S.stato, richiamoStato) || inSuono) return;
  if (millis() - ultimoRichiamo <= richiamoOgni) return;
  if (richiamoFino && (long)(millis() - richiamoFino) > 0) { fermaRichiamo(); return; }
  ultimoRichiamo = millis();
  suona(richiamo, richiamoQuante);
}

/* ===================================================================
 * DISEGNARE
 * =================================================================== */

/* ===================================================================
 * ARCHI E SPICCHI, SENZA SCALETTE
 *
 * Adafruit_GFX non sa fare archi. Prima li si faceva A RAGGI: una riga
 * dal bordo interno a quello esterno ogni 0,4°, che all'esterno distano
 * meno di un pixel, quindi niente buchi. Riempiva, ma i due bordi tondi
 * venivano SEGHETTATI, ed è quello che si è visto al banco il
 * 2026-10-31: ogni raggio finisce su un pixel intero, e mentre l'angolo
 * gira il pixel intero più vicino al cerchio salta avanti e indietro di
 * uno. Su un vetro da 33 mm un pixel è un decimo di millimetro: si vede.
 *
 * Adesso si va PER PIXEL, e il pixel di bordo si accende A META' se è
 * mezzo dentro e mezzo fuori. È antialiasing fatto a mano, e qui costa
 * poco per un motivo preciso: il fondo è NERO sia dentro sia fuori
 * dall'anello, quindi «mezzo acceso» vuol dire semplicemente il colore
 * smorzato a metà. Non c'è nessun fondo da leggere — e non si potrebbe:
 * senza buffer il vetro non si rilegge.
 *
 * I DUE TAGLI DI UN SETTORE RESTANO NETTI, e non è una rinuncia: un
 * taglio sta sempre fra due pezzi tutti e due accesi — il colore e lo
 * SPENTO — e sfumarlo verso il nero lascerebbe in mezzo una riga scura
 * che adesso non c'è.
 *
 * Da che parte di un taglio sta un pixel lo dice un PRODOTTO
 * VETTORIALE, non un atan2: su un Cortex-M0+ senza virgola mobile atan2
 * è caro, e qui si guardano migliaia di pixel a ogni ridisegno. Un
 * prodotto vettoriale però sa dire «da che parte della riga» e non
 * «quanto in là», quindi un settore più largo di mezzo giro si spezza
 * in due.
 *
 * Si scorre per RIGHE, e di ogni riga si calcolano i due tratti che
 * l'anello occupa: così si toccano solo i pixel dell'anello invece di
 * tutto il quadrato che lo contiene.
 * =================================================================== */

/* Il colore smorzato. Il fondo è nero, quindi smorzare è mescolare. */
uint16_t smorza(uint16_t c, float f) {
  if (f >= 0.996) return c;
  int r = (int)(((c >> 11) & 0x1F) * f + 0.5);
  int g = (int)(((c >> 5) & 0x3F) * f + 0.5);
  int b = (int)((c & 0x1F) * f + 0.5);
  return (uint16_t)((r << 11) | (g << 5) | b);
}

/* Mezzo giro al massimo. Gradi a partire dalle dodici, in senso orario:
   è il verso in cui si legge un tempo che passa. `tutto` salta la prova
   dell'angolo, perché un anello intero di tagli non ne ha. */
void mezzoSettore(int cx, int cy, float rInt, float rEst,
                  float da, float a, uint16_t c, bool tutto) {
  float r1 = rInt - 0.5, r2 = rEst + 0.5;
  /* Le direzioni dei due tagli. Sul vetro la y cresce verso il basso,
     quindi l'angolo che cresce gira in senso orario. */
  float dax = sin(da * DEG_TO_RAD), day = -cos(da * DEG_TO_RAD);
  float aax = sin(a * DEG_TO_RAD),  aay = -cos(a * DEG_TO_RAD);
  float r1q = r1 * r1, r2q = r2 * r2;
  float dentro = (r1 + 1) * (r1 + 1), fuori = (r2 - 1) * (r2 - 1);

  /* SOLO LE RIGHE CHE IL SETTORE TOCCA DAVVERO. Un settore sottile ne
     tocca due o tre, e scorrere tutto l'anello per accenderne venti
     pixel costerebbe quanto rifarlo intero: il conto alla rovescia dello
     stop si aggiorna cento volte, e cento volte tutto l'anello vuol dire
     un telecomando che non risponde più. Gli estremi in altezza stanno
     sui due tagli, più i quarti di giro che cascano dentro al settore —
     è lì che l'arco tocca il suo punto più alto o più basso. */
  float su = 1e9, giu = -1e9;
  float ang[8]; int quanti = 0;
  ang[quanti++] = da; ang[quanti++] = a;
  for (float t = 0; t <= 720; t += 90) if (t > da && t < a && quanti < 8) ang[quanti++] = t;
  for (int i = 0; i < quanti; i++) {
    float co = cos(ang[i] * DEG_TO_RAD);
    float ya = cy - r1 * co, yb = cy - r2 * co;
    if (ya < su) su = ya;
    if (yb < su) su = yb;
    if (ya > giu) giu = ya;
    if (yb > giu) giu = yb;
  }
  if (tutto) { su = cy - r2; giu = cy + r2; }
  int y0 = (int)floor(su) - 1, y1 = (int)ceil(giu) + 1;
  if (y0 < (int)ceil(cy - r2)) y0 = (int)ceil(cy - r2);
  if (y1 > (int)floor(cy + r2)) y1 = (int)floor(cy + r2);

  for (int y = y0; y <= y1; y++) {
    if (y < 0 || y > 239) continue;
    float dy = y - cy;
    float q = r2q - dy * dy;
    if (q <= 0) continue;
    float wo = sqrt(q);
    float wi = (fabs(dy) < r1) ? sqrt(r1q - dy * dy) : -1;

    for (int meta = 0; meta < 2; meta++) {
      int x0, x1;
      if (wi < 0) {                       // la riga non passa dal buco
        if (meta) break;
        x0 = (int)ceil(cx - wo); x1 = (int)floor(cx + wo);
      } else if (meta == 0) {             // il tratto di sinistra
        x0 = (int)ceil(cx - wo); x1 = (int)floor(cx - wi);
      } else {                            // quello di destra
        x0 = (int)ceil(cx + wi); x1 = (int)floor(cx + wo);
      }
      if (x0 < 0) x0 = 0;
      if (x1 > 239) x1 = 239;

      /* I PIXEL PIENI SI SCRIVONO DI FILA. Mandare un pixel per volta
         vuol dire, per ognuno, dire al vetro dove sta prima di dirgli di
         che colore è: undici byte di indirizzo per due byte di colore.
         Una riga intera di indirizzo ne vuole uno solo, e dentro
         all'anello i pixel pieni sono la gran parte. Solo i due bordi
         sfumati vanno uno per uno, perché ognuno ha il suo colore.
         Il giro arriva a x1+1 apposta: l'ultimo passaggio, che non
         disegna niente, è quello che chiude il tratto rimasto aperto. */
      int tratto = -1;
      for (int x = x0; x <= x1 + 1; x++) {
        float cop = 0;
        if (x <= x1) {
          float dx = x - cx;
          bool dentroSettore = true;
          if (!tutto) {
            if (dax * dy - day * dx < 0) dentroSettore = false;        // prima del taglio d'inizio
            else if (aax * dy - aay * dx > 0) dentroSettore = false;   // dopo quello di fine
          }
          if (dentroSettore) {
            float dq = dx * dx + dy * dy;
            if (dq > r1q && dq < r2q) {
              cop = 1;
              /* La radice si paga solo sui due bordi: in mezzo è pieno. */
              if (dq < dentro || dq > fuori) {
                float d = sqrt(dq);
                float a1 = r2 - d, a2 = d - r1;
                cop = a1 < a2 ? a1 : a2;
                if (cop > 1) cop = 1;
                if (cop < 0) cop = 0;
              }
            }
          }
        }
        if (cop >= 1) { if (tratto < 0) tratto = x; continue; }
        if (tratto >= 0) {
          carrier.display.drawFastHLine(tratto, y, x - tratto, c);
          tratto = -1;
        }
        if (cop > 0) carrier.display.drawPixel(x, y, smorza(c, cop));
      }
    }
  }
}

void settoreTondo(int cx, int cy, float rInt, float rEst,
                  float da, float a, uint16_t c) {
  if (a <= da) return;
  if (a - da >= 359.9) { mezzoSettore(cx, cy, rInt, rEst, 0, 360, c, true); return; }
  while (a - da > 180.0) {
    mezzoSettore(cx, cy, rInt, rEst, da, da + 180.0, c, false);
    da += 180.0;
  }
  mezzoSettore(cx, cy, rInt, rEst, da, a, c, false);
}

void settore(float da, float a, uint16_t c) {
  settoreTondo(CX, CY, R_INT, R_EST, da, a, c);
}

float anelloDisegnato = -1;
uint16_t anelloColore = 0;

/* Meno di questo, in percento, non muove nemmeno un pixel di arco: un
   grado e mezzo a raggio 101 sono due pixel e mezzo. Sotto, non si
   disegna E NON SI SPOSTA IL CONFINE — spostarlo senza disegnare
   lascerebbe indietro per sempre il pezzetto saltato. */
const float PASSO_ANELLO = 0.4;

void anello(float pc, uint16_t c, bool rifai) {
  if (pc < 0) pc = 0;
  if (pc > 100) pc = 100;
  if (rifai || c != anelloColore) {
    /* OGNI PIXEL UNA VOLTA SOLA. Prima si faceva tutto l'anello spento e
       poi ci si ridisegnava sopra la parte accesa: a disegno per pixel
       sono due passate intere invece di una, cioè il doppio del tempo in
       cui si vede il vetro cambiare sotto gli occhi. Sulla schermata
       dello stop, dove l'anello è tutto rosso, la prima passata era
       interamente sprecata. */
    settore(pc * 3.6, 360, SPENTO);
    settore(0, pc * 3.6, c);
  } else if (pc < anelloDisegnato - PASSO_ANELLO) {
    /* Torna indietro: è il conto alla rovescia dello stop. Si spegne solo
       il pezzo che se n'è andato — ridisegnare tutto l'anello venti volte
       al secondo vorrebbe dire un anello che tremola invece di svuotarsi. */
    settore(pc * 3.6, anelloDisegnato * 3.6, SPENTO);
  } else if (pc > anelloDisegnato + PASSO_ANELLO) {
    /* Solo il pezzo nuovo: ridisegnare tutto l'anello a ogni punto
       percentuale sarebbe un lampo ogni venti secondi, per niente. */
    settore(anelloDisegnato * 3.6, pc * 3.6, c);
  } else {
    return;        // niente da disegnare: e allora niente si sposta
  }
  anelloDisegnato = pc;
  anelloColore = c;
}

/* LO SPICCHIO del tocco lungo. È un oggetto DIVERSO dall'anello apposta:
   l'anello sta sul bordo e dice a che punto è la stampa, questo sta in
   mezzo e dice a che punto è il tuo dito. Confonderli vorrebbe dire far
   sembrare che la stampa stia tornando indietro.

   SI DISEGNA SOLO LA FETTA NUOVA. Prima si rifaceva tutto lo spicchio a
   ogni aggiornamento — venti volte al secondo, un ventaglio di
   settecento righe — e per quel secondo il telecomando non faceva
   nient'altro. Quello che c'è già non ha bisogno di essere rifatto: è
   la stessa regola dell'anello. */
/* Il centro è a 100 e non a 110: a 110 il disco arrivava a sfiorare
   l'angolo dell'etichetta TIENI, che sta in basso a destra, e una parola
   rossa su un disco rosso non è una parola. */
const int SPIC_CX = 120, SPIC_CY = 100, SPIC_R = 46;

void spicchioCornice(uint16_t c) {
  settoreTondo(SPIC_CX, SPIC_CY, SPIC_R + 4, SPIC_R + 5.5, 0, 360, c);
  /* La punta: lì le due righe del taglio si toccano e un settore sottile
     non copre nemmeno un pixel intero. Un dischetto e non ci si pensa. */
  carrier.display.fillCircle(SPIC_CX, SPIC_CY, 3, c);
}

void spicchio(float da, float a, uint16_t c) {
  settoreTondo(SPIC_CX, SPIC_CY, -1, SPIC_R, da * 360.0, a * 360.0, c);
}

/* Il corpo più grande con cui una riga ci sta ancora nel cerchio libero.
   Un indirizzo come 192.168.100.100 è quindici caratteri: in corpo 2
   sarebbe largo 178 px e finirebbe dentro all'anello. */
int corpoCheCiSta(const char* s, int y, int massimo) {
  for (int k = massimo; k > 1; k--) {
    float dy = max(abs(y - CY), abs(y + alto(k) - CY));
    float mezza = largo(s, k) / 2.0;
    if (mezza * mezza + dy * dy <= R_TESTI * R_TESTI) return k;
  }
  return 1;
}

/* CANCELLARE SU UN VETRO TONDO.
 *
 * Un rettangolo nero largo a piacere TAGLIA L'ANELLO, perché gli angoli
 * di un rettangolo stanno più in là dei suoi lati e a quell'altezza il
 * cerchio libero è già finito. È il difetto visto al banco il
 * 2026-10-31 — l'anello spezzato in basso a destra e in basso a
 * sinistra, dove si riscrive il tempo che resta — e veniva da un
 * `fillRect(40, 174, 160, 16)`: l'angolo in basso a destra cade a 106
 * pixel dal centro, cioè dentro all'anello, che comincia a 95,5.
 *
 * Quanto si può cancellare a una certa altezza non lo decide il testo:
 * lo decide il cerchio. */
void pulisci(int y, int h) {
  float dy = max(abs(y - CY), abs(y + h - CY));
  float q = R_TESTI * R_TESTI - dy * dy;
  if (q <= 0) return;
  int mezza = (int)sqrt(q);
  carrier.display.fillRect(CX - mezza, y, 2 * mezza, h, NERO);
}

void scrivi(const char* s, int y, int k, uint16_t c) {
  carrier.display.setTextSize(k);
  carrier.display.setTextColor(c);
  carrier.display.setCursor(CX - largo(s, k) / 2, y);
  carrier.display.print(s);
}

/* L'ETICHETTA DI UN TASTO si posa per il suo SPIGOLO ESTERNO, non per
   l'angolo da cui parte a scrivere. Su un vetro tondo quello che va a
   sbattere nell'anello è sempre un angolo — quello alto per le etichette
   di sopra, quello basso per quelle di sotto — e mettendo sul raggio
   giusto il punto di appoggio l'angolo finisce comunque di fuori. È il
   difetto trovato sul banco di prova il 2026-10-29, e qui la regola
   nasce già giusta. */
void etichetta(Posto p, const char* parola, const char* sotto, uint16_t c) {
  int righe = sotto ? 2 : 1;
  int w = largo(parola, 2);
  if (sotto && largo(sotto, 2) > w) w = largo(sotto, 2);
  int h = alto(2) * righe;
  bool destra = (p == ALTO_DX || p == BASSO_DX);
  int x, y;
  if (p == BASSO) {
    /* In basso lo spigolo che va a sbattere è quello DI SOTTO, quindi è
       il bordo inferiore della parola che si posa sul raggio. */
    x = CX - w / 2;
    y = CY + (int)sqrt(R_TESTI * R_TESTI - (w / 2.0) * (w / 2.0)) - h;
  } else {
    bool inBasso = (p == BASSO_SX || p == BASSO_DX);
    /* Troncati VERSO il centro: mezzo pixel in dentro non si vede, mezzo
       pixel in fuori finisce nell'anello. */
    int dx = (int)(R_TESTI * cos(30.0 * DEG_TO_RAD));   // 80
    int dy = (int)(R_TESTI * sin(30.0 * DEG_TO_RAD));   // 46
    x = destra ? (CX + dx) - w : (CX - dx);
    y = inBasso ? (CY + dy) - h : (CY - dy);
  }
  carrier.display.setTextSize(2);
  carrier.display.setTextColor(c);
  /* Le due righe si allineano DALLA PARTE DEL TASTO: a destra per i tasti
     di destra, a sinistra per quelli di sinistra, centrate in basso. Una
     colonna di parole allineata dalla parte sbagliata sembra un elenco, non
     un'etichetta. */
  for (int i = 0; i < righe; i++) {
    const char* r = i ? sotto : parola;
    int wr = largo(r, 2);
    int xr = (p == BASSO) ? (CX - wr / 2) : (destra ? (x + w - wr) : x);
    carrier.display.setCursor(xr, y + i * alto(2));
    carrier.display.print(r);
  }
}

/* IL PALLINO DEL COLORE: di che penna si sta parlando. Un pallino e non
   la parola «nero»: a un decimo di millimetro per pixel una parola di
   quattro lettere è alta due millimetri e si indovina, un pallino
   colorato si vede. Il contorno chiaro non è decorazione — la penna nera
   è il caso normale, e un disco nero su fondo nero non è un pallino, è
   niente. */
uint16_t daEsadecimale(const char* s) {
  if (s[0] != '#') return 0;
  long v = strtol(s + 1, nullptr, 16);
  int n = strlen(s + 1);
  int r, g, b;
  if (n == 3) {                       // #rgb, come lo scrive il SLICER
    r = ((v >> 8) & 0xF) * 17; g = ((v >> 4) & 0xF) * 17; b = (v & 0xF) * 17;
  } else {
    r = (v >> 16) & 0xFF; g = (v >> 8) & 0xFF; b = v & 0xFF;
  }
  return COL(r, g, b);
}

void pallino(const char* esa, int y) {
  if (!esa[0]) return;               // livello senza tinta: non si inventa
  carrier.display.fillCircle(CX, y, 7, daEsadecimale(esa));
  carrier.display.drawCircle(CX, y, 7, SMORTO);
}

/* «MONTA ●»: la parola e il pallino sulla STESSA riga, centrati insieme.
   Il pallino stava da solo più in basso, e a quell'altezza c'è
   l'etichetta del tasto in basso a destra: letti di fila diventavano una
   didascalia — «pallino PROVA» — e il tasto spariva dentro alla frase.
   Era la domanda arrivata dal banco il 2026-10-31: «c'è una scritta
   PROVA che non capisco». Accanto alla parola il pallino dice quello che
   deve dire, cioè DI CHE COLORE è la penna da montare, e la riga sotto
   torna a essere di chi è: del tasto. */
void parolaEPallino(const char* s, const char* esa, int y, int k, uint16_t c) {
  if (!esa[0]) { scrivi(s, y, k, c); return; }
  const int R = 7, ARIA = 10;
  int w = largo(s, k) + ARIA + 2 * R;
  int x = CX - w / 2;
  carrier.display.setTextSize(k);
  carrier.display.setTextColor(c);
  carrier.display.setCursor(x, y);
  carrier.display.print(s);
  int px = x + largo(s, k) + ARIA + R, py = y + alto(k) / 2;
  carrier.display.fillCircle(px, py, R, daEsadecimale(esa));
  carrier.display.drawCircle(px, py, R, SMORTO);
}

/* LA PILA. Non sta su tutte le schermate, e non è una dimenticanza: un
   indicatore sempre acceso è un numero che si smette di guardare dopo due
   giorni. Compare sulla schermata Pronta — quella che hai davanti quando
   lo prendi in mano — e sotto al 20% dappertutto, in rosso, perché lì non
   è un dato ma un avviso. Più un terzo posto: sulla schermata in attesa,
   ma solo attaccato alla corrente, perché quella è la schermata che resta
   su mentre lo carichi.

   Attenzione al numero MENTRE CARICA: la percentuale viene dalla tensione,
   e sotto carica la tensione è più alta di quella che la cella avrà dopo.
   Un 100% col fulminetto acceso può essere un 95% vero. Il fulmine conta
   più del numero. */
int batteria = -1;
Spina spina = A_BATTERIA;

bool allaSpina() { return spina != A_BATTERIA; }

/* COME SI DISEGNA, che non è come sta. «In carica» e «carica finita» sul
   vetro sono la stessa cosa — pila verde col fulmine — e tenerle separate
   costerebbe una schermata intera rifatta ogni volta che il caricabatterie
   passa dall'una all'altra. A cella piena ci passa in continuazione:
   termina la carica, la tensione cala di un pelo, ne comincia un'altra. Al
   banco, il 2026-11-01, erano due volte ogni cinque secondi: due schermate
   al secondo per non cambiare un pixel. */
int pittura(Spina s) { return s == A_BATTERIA ? 0 : s == FERMA ? 2 : 1; }

/* IL COLORE DICE PRIMA DEL NUMERO, e attaccato alla corrente dice
   un'altra cosa: il 12% di una cella che sta caricando non è un
   allarme, è una cella che sta caricando, e lasciarlo rosso
   insegnerebbe a non fidarsi del rosso. */
uint16_t coloreCarica(int pc) {
  if (spina == FERMA) return AMBRA;      // la spina c'è ma non entra niente
  if (spina != A_BATTERIA) return VERDE;
  return pc < 20 ? ROSSO : pc < 40 ? AMBRA : SMORTO;
}

/* IL FULMINE, BIANCO E NON VERDE. Sta dentro alla pila, quindi per metà
   finisce sopra al pieno — che è verde — e per metà sopra al nero di
   quello che manca. Il bianco è l'unico colore che si vede su entrambi;
   un fulmine verde sparirebbe dentro al pieno proprio quando la carica
   sale, cioè quando serve guardarlo. */
void fulmine(int cx, int y, int h, uint16_t c) {
  int m = y + h / 2;
  carrier.display.fillTriangle(cx + 2, y,     cx - 3, m + 1, cx + 1, m + 1, c);
  carrier.display.fillTriangle(cx - 2, y + h, cx + 3, m - 1, cx - 1, m - 1, c);
}

void pila(int pc, int y, bool colNumero) {
  if (pc < 0) return;
  uint16_t c = coloreCarica(pc);
  int w = 26, h = 13;
  char n[6]; snprintf(n, sizeof(n), "%d%%", pc);
  int wn = colNumero ? largo(n, 2) + 6 : 0;
  int x = CX - (w + 4 + wn) / 2;
  carrier.display.drawRoundRect(x, y, w, h, 3, c);
  carrier.display.fillRect(x + w + 1, y + 4, 3, 5, c);
  int pieno = (w - 6) * pc / 100;
  if (pieno > 0) carrier.display.fillRect(x + 3, y + 3, pieno, h - 6, c);
  if (allaSpina()) fulmine(x + w / 2, y + 1, h - 2, TESTO);
  if (colNumero) {
    carrier.display.setTextSize(2);
    carrier.display.setTextColor(c);
    carrier.display.setCursor(x + w + 8, y - 1);
    carrier.display.print(n);
  }
}

/* I SIMBOLI. Archi, rettangoli, cerchi e triangoli: quello che
   Adafruit_GFX sa fare, perché senza buffer non c'è altro. */
void simboloCasa(int y, uint16_t c) {
  carrier.display.drawLine(CX - 22, y + 4, CX, y - 16, c);
  carrier.display.drawLine(CX, y - 16, CX + 22, y + 4, c);
  carrier.display.drawRect(CX - 16, y + 4, 32, 18, c);
  carrier.display.drawRect(CX - 5, y + 12, 10, 10, c);
}

void simboloPenna(int y, uint16_t c, bool giu) {
  int dy = giu ? 0 : -14;
  carrier.display.drawRect(CX - 6, y + dy - 18, 12, 18, c);
  carrier.display.fillTriangle(CX - 6, y + dy, CX + 6, y + dy, CX, y + dy + 10, c);
  carrier.display.drawFastHLine(CX - 18, y + 18, 36, c);   // il piano
}

void simboloSpunta(int y, uint16_t c) {
  for (int i = 0; i < 4; i++) {
    carrier.display.drawLine(CX - 22, y + i, CX - 6, y + 16 + i, c);
    carrier.display.drawLine(CX - 6, y + 16 + i, CX + 24, y - 14 + i, c);
  }
}

void simboloAllarme(int y, uint16_t c) {
  carrier.display.drawTriangle(CX, y - 22, CX + 23, y + 19, CX - 23, y + 19, c);
  carrier.display.drawTriangle(CX, y - 18, CX + 19, y + 17, CX - 19, y + 17, c);
  carrier.display.fillRect(CX - 2, y - 9, 5, 16, c);
  carrier.display.fillCircle(CX, y + 12, 3, c);
}

void simboloDivieto(int y, uint16_t c) {
  carrier.display.drawCircle(CX, y, 24, c);
  carrier.display.drawCircle(CX, y, 23, c);
  carrier.display.drawLine(CX - 17, y - 17, CX + 17, y + 17, c);
  carrier.display.drawLine(CX - 16, y - 17, CX + 18, y + 17, c);
}

void simboloSenzaRete(int y, uint16_t c) {
  for (int i = 0; i < 2; i++) {
    carrier.display.drawCircleHelper(CX, y + 16, 30 + i, 1, c);
    carrier.display.drawCircleHelper(CX, y + 16, 30 + i, 2, c);
    carrier.display.drawCircleHelper(CX, y + 16, 17 + i, 1, c);
    carrier.display.drawCircleHelper(CX, y + 16, 17 + i, 2, c);
  }
  carrier.display.fillCircle(CX, y + 14, 4, c);
}

/* Il tempo che resta, come lo scrive il SLICER: un numero e «min». Sotto
   le venti righe il Sender non l'ha ancora misurato e manda -1 — e allora
   al suo posto non ci va un numero inventato, ci va «misuro». */
/* VERO QUANDO IL FOGLIO VA SCRITTO. Con uno solo no: «foglio 1 di 1»
   occuperebbe una riga di vetro per non distinguere niente, ed e' anche il
   caso di ogni programma scritto prima del 2026-11-07. */
bool diceIlFoglio() { return S.foglioDi >= 2 && S.foglioN >= 1; }

/* «FOGLIO 3/9». Sotto la percentuale: non e' la cosa che si guarda per
   prima -- quella e' quanto manca -- ma e' quella che dice se il magnete
   che hai davanti e' finito.
   DOVE STA NON E' LIBERO. Sul vetro, fra la percentuale e il tempo che
   manca, ci passa l'etichetta del tasto STOP: occupa la fascia 152-162 a
   destra di x=154, e una riga larga come questa ci sbatte dentro. Per
   questo quando il foglio si scrive TUTTO SI ALZA di quattordici pixel --
   il pallino della penna e la percentuale -- e la riga nuova sta nel posto
   che si e' liberato. Con un foglio solo la schermata resta esattamente
   quella di prima, che e' il caso della maggior parte delle stampe. */
void scriviFoglio(int y) {
  if (!diceIlFoglio()) return;
  char t[18];
  snprintf(t, sizeof(t), "FOGLIO %d/%d", S.foglioN, S.foglioDi);
  scrivi(t, y, 2, FIOCO);
}

void scriviRimanente(int y) {
  char t[12];
  if (S.rimanente < 0) { scrivi("misuro", y, 2, FIOCO); return; }
  long m = (S.rimanente + 59999) / 60000;
  if (m < 1) m = 1;
  snprintf(t, sizeof(t), "~%ld min", m);
  scrivi(t, y, 2, SMORTO);
}

char ipTesto[20] = "";

/* LA SCHERMATA INTERA. Si rifà solo quando cambia qualcosa che non si può
   aggiornare sul posto; il resto del tempo si tocca solo l'anello e i due
   numeri che si muovono. */
void disegnaTutto(Schermata s) {
  carrier.display.fillScreen(NERO);
  anelloDisegnato = -1;

  char n[8];
  switch (s) {
    case PRONTA:
      anello(0, SPENTO, true);
      simboloCasa(84, VERDE);
      scrivi("PRONTA", 118, 3, TESTO);
      /* Pronta e azzerata non sono la stessa cosa: una macchina accesa ma
         non azzerata non sa dove sia, e farla partire disegna da
         un'altra parte. Il dato c'è nel messaggio, tanto vale dirlo. */
      scrivi(S.azzerata ? "al punto home" : "da azzerare", 150, 2,
             S.azzerata ? FIOCO : AMBRA);
      pila(batteria, 180, true);
      break;

    case STAMPA:
      anello(S.percento, BLU, true);
      pallino(S.penna, diceIlFoglio() ? 60 : 74);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, diceIlFoglio() ? 82 : 96, 6, TESTO);
      scriviFoglio(132);
      scriviRimanente(174);
      break;

    case IN_PAUSA:
      anello(S.percento, AMBRA, true);
      carrier.display.fillRect(CX - 15, 78, 10, 32, AMBRA);
      carrier.display.fillRect(CX + 5, 78, 10, 32, AMBRA);
      /* A 130 la parola arrivava addosso all'etichetta STOP, che sta in
         basso a destra: le due si toccavano per quattro pixel. */
      scrivi("PAUSA", 118, 3, TESTO);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 150, 2, FIOCO);
      break;

    case PENNA1:
      anello(S.percento, AMBRA, true);
      simboloPenna(90, AMBRA, false);
      scrivi("TOGLI", 118, 3, TESTO);
      scrivi("LA PENNA", 146, 2, TESTO);
      break;

    case PENNA2:
      anello(S.percento, AMBRA, true);
      /* Stava tutto più in alto perché l'etichetta del tasto in basso a
         destra era di DUE righe («ABBASSA / E ALZA»). Adesso è di una sola
         — dice l'azione — e il vetro torna alle altezze delle altre
         schermate, dove la parola grande sta in mezzo. */
      simboloPenna(88, VERDE, true);
      parolaEPallino("MONTA", S.penna, 116, 3, TESTO);
      break;

    /* PENNA3: la punta della penna nuova va ritrovata sul foglio. Il verde
       e' lo stesso del montaggio, perche' e' la coda dello stesso gesto;
       la seconda riga dice DOVE si fa, visto che qui non si fa. */
    case PENNA3:
      anello(S.percento, AMBRA, true);
      simboloPenna(88, VERDE, true);
      scrivi("ANGOLO", 116, 3, TESTO);
      scrivi("DAL PC", 146, 2, FIOCO);
      break;

    case STOP_ARMATO:
      anello(100, ROSSO, true);
      simboloDivieto(80, ROSSO);
      scrivi("FERMARE?", 118, 3, TESTO);
      break;

    case STOP_TIENI:
      anello(100, ROSSO, true);
      break;

    /* FERMANDO: l'anello resta dov'era, perche' la macchina sta ancora
       finendo le righe che ha in pancia. Il grigio dice che e' un momento
       di passaggio e non uno stato. */
    case FERMANDO:
      anello(S.percento >= 0 ? S.percento : 0, SMORTO, true);
      simboloDivieto(84, SMORTO);
      scrivi("FERMO", 126, 3, SMORTO);
      break;

    /* FERMATA: la percentuale a cui si e' fermata e' l'unica cosa che
       serve sapere — dice quanto foglio e' stato disegnato. */
    case FERMATA:
      anello(S.percento >= 0 ? S.percento : 0, AMBRA, true);
      simboloDivieto(84, AMBRA);
      scrivi("FERMATA", 126, 3, TESTO);
      if (S.percento >= 0) {
        char dove[12];
        snprintf(dove, sizeof(dove), "al %d%%", S.percento);
        scrivi(dove, 158, 2, FIOCO);
      }
      if (batteria >= 0 && batteria < 20 && !allaSpina()) pila(batteria, 196, false);
      break;

    case FINE:
      anello(100, VERDE, true);
      simboloSpunta(84, VERDE);
      scrivi("FATTO", 126, 3, TESTO);
      if (batteria >= 0 && batteria < 20 && !allaSpina()) pila(batteria, 196, false);
      break;

    case ERRORE:
      anello(100, ROSSO, true);
      simboloAllarme(84, ROSSO);
      scrivi("FERMA", 126, 3, TESTO);
      if (batteria >= 0 && batteria < 20 && !allaSpina()) pila(batteria, 196, false);
      break;

    case ATTESA:
      anello(0, SPENTO, true);
      simboloSenzaRete(70, FIOCO);
      scrivi("IN ATTESA", 126, 2, SMORTO);
      /* L'indirizzo è l'unica cosa utile da guardare qui: è quello da
         copiare nelle impostazioni del SLICER. */
      scrivi(ipTesto, 152, corpoCheCiSta(ipTesto, 152, 2), FIOCO);
      /* QUI LA PILA COMPARE SOLO ALLA SPINA, e non è un'eccezione alla
         regola: è la regola. Questa è la schermata che il telecomando
         tiene su mentre lo carichi col portatile chiuso, e in quel
         momento «sta caricando?» è l'unica domanda che ha una risposta
         utile. A batteria, invece, qui un numero non serve a niente:
         non c'è nessuna stampa da far reggere. */
      if (allaSpina()) pila(batteria, 184, true);
      break;

    case NESSUNA:
      break;   // non è una schermata: vedi l'enum
  }

  Tasto t[MAX_TASTI];
  int q = tastiDi(s, t);
  for (int i = 0; i < q; i++)
    etichetta(t[i].dove, t[i].parola, t[i].sotto, t[i].colore);
}

/* Quello che si muove senza rifare la schermata: l'anello, la
   percentuale e lo spicchio del dito. */
int pcDisegnato = -999;
int caricaDisegnata = -999;
int pitturaDisegnata = 0;
/* NON BASTA SAPERE QUALE schermata c'è sul vetro: bisogna sapere anche
   che cosa ci era scritto sopra. Una macchina che viene azzerata resta
   sulla schermata PRONTA — cambia solo la riga sotto, da «da azzerare» a
   «al punto home» — e senza questo il vetro continuerebbe a dire quella
   vecchia finché non cambia schermata per altri motivi. Stessa storia per
   il pallino del colore, che arriva un attimo dopo l'inizio della stampa:
   il segno di penna sta nel G-code all'inizio del livello, cioè qualche
   millisecondo dopo che lo stato è diventato «invio». */
bool azzerataDisegnata = false;
int giuDisegnato = -2;
char pennaDisegnata[10] = "";
/* Il numero del foglio cambia SENZA cambiare schermata, come il pallino
   della penna: con l'ordine per penna la punta salta da un foglio
   all'altro restando in «invio», e senza questo il vetro continuerebbe a
   dire il foglio di prima fino alla fine della stampa. */
int foglioDisegnato = -1;

/* QUELLO CHE CAMBIA LA FACCIA DEL VETRO SENZA CAMBIARE SCHERMATA.
 * `giu` cambia l'ETICHETTA di un tasto; il pallino del colore arriva un
 * attimo dopo l'inizio della stampa; una macchina azzerata resta sulla
 * schermata PRONTA e cambia solo la riga sotto; e dal 2026-11-07 il
 * numero del foglio cambia mentre si resta in «invio» -- con l'ordine per
 * penna la punta salta da un foglio all'altro di continuo. Senza questo
 * controllo il vetro resterebbe su quello che c'era fino al prossimo
 * cambio di schermata, cioe' a volte fino alla fine della stampa.
 * E' una funzione e non una riga dentro a `loop()` perche' cosi' il banco
 * del vetro puo' chiamarla: quello che sta dentro al giro principale, qui,
 * non si riesce a provare. */
bool vetroDaRifare() {
  return S.azzerata != azzerataDisegnata ||
         strcmp(S.penna, pennaDisegnata) != 0 ||
         S.giu != giuDisegnato ||
         S.foglioN != foglioDisegnato;
}
float tenutaDisegnata = -1;

void aggiornaPezzi(Schermata s) {
  char n[8];
  if (s == STAMPA) {
    anello(S.percento, BLU, false);
    if (S.percento != pcDisegnato) {
      pulisci(96, 48);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 96, 6, TESTO);
      pulisci(174, 16);
      scriviRimanente(174);
      pcDisegnato = S.percento;
    }
  } else if (s == IN_PAUSA) {
    anello(S.percento, AMBRA, false);
    if (S.percento != pcDisegnato) {
      pulisci(150, 16);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 150, 2, FIOCO);
      pcDisegnato = S.percento;
    }
  } else if (s == STOP_ARMATO) {
    /* L'anello diventa il conto alla rovescia e si SVUOTA: se non
       rispondi, la domanda se ne va da sola. Va al contrario di come
       andava un attimo prima, quindi non lo si scambia per
       l'avanzamento. */
    unsigned long passato = millis() - armatoDa;
    float resta = passato >= ARMATO_MS ? 0 : 100.0 * (ARMATO_MS - passato) / ARMATO_MS;
    anello(resta, ROSSO, false);
  } else if (s == PRONTA || s == ATTESA) {
    /* La pila, e solo lei: il resto della schermata non si muove. */
    int y = (s == PRONTA) ? 180 : 184;
    if (batteria != caricaDisegnata && (s == PRONTA || allaSpina())) {
      pulisci(y - 2, 18);
      pila(batteria, y, true);
      caricaDisegnata = batteria;
    }
  } else if (s == STOP_TIENI) {
    float f = (float)(millis() - tenutoDa) / TENUTA_MS;
    if (f > 1) f = 1;
    if (tenutaDisegnata < 0) { spicchioCornice(ROSSO); tenutaDisegnata = 0; }
    if (f - tenutaDisegnata > 0.02) {
      spicchio(tenutaDisegnata, f, ROSSO);
      tenutaDisegnata = f;
    }
  }
}

/* I LED: quello accanto a un tasto vivo si accende del colore di quello
 * che il tasto fa. Piano — girano sul 5 V generato a bordo, quindi la
 * luminosità costa più di quanto sembri, e questo coso sta a batteria.
 *
 * IL COLORE DEL LED NON È QUELLO DEL VETRO. È il difetto visto al banco
 * il 2026-10-31: «i LED non hanno un colore ben definito». I colori
 * delle scritte sono scelti per un vetro nero — un rosso chiaro, un
 * ambra tenue — e hanno tutti e tre i canali accesi: #E05252 è rosso
 * solo accanto a qualcos'altro. Su un LED grosso come una capocchia di
 * spillo tre canali accesi fanno BIANCO ROSATO, ed è esattamente quello
 * che si vedeva. Il vetro vuole colori morbidi, il LED li vuole PURI.
 *
 * E si tiene basso con un numero solo, LUCE_LED, invece di dividere il
 * colore: dividere abbassa anche la DIFFERENZA fra i canali, e a un
 * sedicesimo un rosso e un ambra diventano lo stesso arancione sbiadito
 * — un'altra metà dello stesso difetto. */
const uint8_t LUCE_LED = 40;        // su 255. Più in alto abbaglia al buio.

void tintaLed(uint16_t c, uint8_t* v) {
  int r, g, b;
  if      (c == ROSSO) { r = 255; g = 0;   b = 0;   }
  else if (c == BLU)   { r = 0;   g = 40;  b = 255; }
  else if (c == AMBRA) { r = 255; g = 60;  b = 0;   }
  else if (c == VERDE) { r = 0;   g = 255; b = 40;  }
  else                 { r = 255; g = 255; b = 255; }
  v[0] = r * LUCE_LED / 255;
  v[1] = g * LUCE_LED / 255;
  v[2] = b * LUCE_LED / 255;
}

/* VERO SE UN LED È ACCESO ADESSO. Non è un vezzo: la prova della spina
   (vedi «LA SPINA») toglie il 5 V per ottanta millisecondi, e ottanta
   millisecondi di buio su un LED spento non si vedono, su un LED acceso
   sì. Serve a decidere quanto spesso si può provare. */
bool ledAccesi = false;

void accendiLed(Schermata s) {
  Tasto t[MAX_TASTI];
  int q = tastiDi(s, t);
  ledAccesi = q > 0;
  uint8_t acceso[5][3] = {{0}};
  for (int i = 0; i < q; i++) {
    int k = (int)padDi(t[i].dove);
    tintaLed(t[i].colore, acceso[k]);
  }
  for (int k = 0; k < 5; k++)
    carrier.leds.setPixelColor(k, acceso[k][0], acceso[k][1], acceso[k][2]);
  carrier.leds.show();
}

/* ===================================================================
 * LA RETROILLUMINAZIONE
 *
 * Dietro a D3 non c'è un transistor: c'è un alimentatore a innalzamento
 * (U3/U6 con l'induttanza da 10 µH) che tira la fila di LED del pannello.
 * Spegnere FERMA il convertitore, quindi risparmia corrente vera e non
 * solo luce; un'onda quadra lo attenua, quindi «acceso ma piano» esiste e
 * costa meno di «acceso».
 * =================================================================== */
const unsigned long BUIO_MS = 60000;    // un minuto di niente e si abbassa
unsigned long ultimoMovimento = 0;
int luceOra = -1;

void luce(int v) {
  if (v == luceOra) return;
  analogWrite(TFT_BACKLIGHT, v);
  luceOra = v;
}

void sveglia() { ultimoMovimento = millis(); }

void gestisciLuce(Schermata s) {
  bool succede = (s == STAMPA || s == IN_PAUSA || s == PENNA1 || s == PENNA2 ||
                  s == PENNA3 || s == STOP_ARMATO || s == STOP_TIENI);
  if (succede || millis() - ultimoMovimento < BUIO_MS) luce(255);
  else luce(12);    // non spento: spento sembra rotto, e questo deve dire «ci sono»
}

/* ===================================================================
 * LA CARICA
 *
 * `ADC_BATTERY` c'è davvero sul MKR WiFi 1010 (pin 32, PB09): la tensione
 * della 18650 arriva al convertitore attraverso un partitore già sulla
 * scheda. Il rapporto esatto il core non lo dichiara, quindi `K` qui
 * sotto è DA TARARE una volta sola: misura la batteria col tester, leggi
 * sul monitor seriale il grezzo che il telecomando stampa all'avvio, e
 * fai il conto. Finché non lo fai il numero è un'approssimazione, e una
 * percentuale sbagliata del 10% su una Li-ion si nota poco — ma si nota.
 *
 * Dalla tensione la percentuale è comunque un'approssimazione, perché la
 * curva di una Li-ion è piatta in mezzo: niente decimali, e si guarda il
 * colore.
 * =================================================================== */
/* 1,284 E NON 2. Misurato al banco il 2026-11-01 con i due numeri presi
   NELLO STESSO ISTANTE — reset premuto, tester sulla cella mentre il
   monitor stampava: grezzo 982,37 su 1023, cioè 3,169 V sul piedino, con
   la cella a 4,07 V. Il primo tentativo (1,233) veniva da un tester letto
   in un altro momento, a spina staccata, e sbagliava di 4 punti: è
   esattamente il motivo per cui i due numeri vanno presi insieme.

   QUESTO K NON È IL PARTITORE: è tutta la catena. Dentro ci sono le due
   resistenze E la tensione vera del riferimento del convertitore, che non
   è esattamente 3,3 V. Per questo non viene un numero tondo, e per questo
   si misura invece di leggerlo da uno schema.

   Fondo scala: 3,3 × 1,284 = 4,24 V di cella, cioè SOPRA una Li-ion piena.
   Il muro che temevo a 4,07 non c'è, e V_PIENA può restare 4,15.

   CONFERMATO con un secondo punto, lo stesso giorno, a corrente ferma: la
   finestra lunga stampava 3,70 V col grezzo a 893 e il tester sulla cella
   diceva 3,70 V. I due punti stanno 0,37 V lontani e danno K = 1,2843 e
   K = 1,2844: si accordano meglio di quanto il tester sappia risolvere.

   Due punti lontani dicono una cosa che un punto solo non può dire: se il
   K non cambia fra l'uno e l'altro, nella catena NON c'è un offset e un
   rapporto solo basta — non serve una retta. Qui non cambia.

   E in quei cinque secondi il grezzo è stato fermo fra 893 e 894: a
   corrente zero il ballo di diciassette punti non c'è. Era il carico. */
const float K_PARTITORE = 1.284;     // misurato e confermato su due punti
const float V_VUOTA = 3.30, V_PIENA = 4.15;

/* ===================================================================
 * E LA CARICA NON INSEGUE IL CARICO
 *
 * Al banco, il 2026-11-01: 73, 67, 57, 65, 67, 67, 74 — diciassette punti
 * di ballo ogni dieci secondi, a cella ferma. Non è il convertitore che
 * sbaglia: è la TENSIONE CHE SI MUOVE DAVVERO. Diciassette punti sono
 * 0,145 V, ed è quello che la cella perde quando il WiFi trasmette, il
 * vetro si riaccende o il cicalino canta: la corrente passa per la
 * resistenza interna della cella, per le molle del portabatteria e per i
 * due contatti del cavetto, e ogni pezzo si prende la sua caduta. Con
 * burst da un paio di decimi di ampere, 0,145 V vuol dire mezzo ohm
 * abbondante in giro — quasi tutto nei contatti, non nella cella.
 *
 * Misurare meglio non si può: la caduta è vera. Ma UN INDICATORE DI
 * CARICA CHE BALLA NON È UN INDICATORE — è un numero che si impara a non
 * guardare, che è il modo peggiore di perdere un dato. Quindi:
 *
 * 1. SI ASSAGGIA SPESSO E SI TIENE IL PICCO. La caduta tira solo in giù,
 *    mai in su: il massimo su due secondi è il momento in cui nessuno
 *    stava chiedendo corrente, cioè la tensione vera della cella. Una
 *    media, fra i buchi, ci casca dentro.
 * 2. SI FILTRA, con una media che pesa il passato tre volte il presente.
 * 3. IL NUMERO SI MUOVE DI UN PUNTO PER VOLTA. Una batteria non salta
 *    dieci punti in dieci secondi, e se il conto lo fa è il conto a
 *    sbagliare: meglio arrivarci in venti secondi e non mentire mai.
 * =================================================================== */
unsigned long ultimaCarica = 0, ultimoAssaggio = 0;
int piccoGrezzo = 0;
float vFiltrata = -1;

void leggiCarica(bool subito) {
  unsigned long ora = millis();

  /* ALLA SPINA NON SI MISURA QUI, SI MISURA NELLA FINESTRA.
     Al banco, il 2026-11-01: 35% a batteria, spina attaccata e reset, e
     il numero salta a 89. Non è un difetto del filtro — il filtro ha
     fatto il suo lavoro — è che MENTRE CARICA LA TENSIONE NON DICE LA
     CARICA. La corrente di carica attraversa la stessa mezz'ohm di molle
     e contatti, ma al contrario, e invece di una caduta fa un rialzo: a
     mezzo ampere sono due decimi e mezzo di volt, più gli ottanta
     millivolt di caduta che spariscono, cioè una trentina di punti
     percentuali di niente. Il picco su due secondi non salva: qui il
     picco è proprio il male.

     Quindi alla spina questa funzione non assaggia nemmeno, e il numero
     lo fa `finestra()`, che la carica la ferma per trecento millisecondi
     e misura una cella a corrente zero. `FERMA` invece sta a batteria a
     tutti gli effetti: la spina c'è ma non entra niente. */
  if (allaSpina() && spina != FERMA) { piccoGrezzo = 0; return; }

  /* Un assaggio ogni decimo di secondo: sparsi, perché otto letture tutte
     attaccate cascherebbero tutte dentro allo stesso buco. */
  if (subito || ora - ultimoAssaggio >= 100) {
    ultimoAssaggio = ora;
    int g = analogRead(ADC_BATTERY);
    if (g > piccoGrezzo) piccoGrezzo = g;
  }

  if (!subito && (ora - ultimaCarica < 2000 || piccoGrezzo == 0)) return;
  ultimaCarica = ora;

  /* All'accensione non c'è tempo di assaggiare: si prendono otto letture
     di fila e si tiene il picco anche lì. */
  if (subito)
    for (int i = 0; i < 8; i++) {
      int g = analogRead(ADC_BATTERY);
      if (g > piccoGrezzo) piccoGrezzo = g;
    }

  float grezzo = piccoGrezzo;
  piccoGrezzo = 0;
  float v = grezzo * (3.3 / 1023.0) * K_PARTITORE;
  vFiltrata = (vFiltrata < 0) ? v : vFiltrata + (v - vFiltrata) * 0.25;

  int pc = (int)(100.0 * (vFiltrata - V_VUOTA) / (V_PIENA - V_VUOTA));
  pc = pc < 0 ? 0 : (pc > 100 ? 100 : pc);
  if (batteria < 0 || subito)   batteria = pc;
  else if (pc > batteria)       batteria++;
  else if (pc < batteria)       batteria--;

  if (subito) {
    Serial.print("ADC_BATTERY picco: "); Serial.print(grezzo);
    Serial.print("  con K="); Serial.print(K_PARTITORE);
    Serial.print(" fa "); Serial.print(v); Serial.println(" V");
  }
}

/* ===================================================================
 * LA SPINA
 *
 * IL CARICABATTERIE NON STA SUL CARRIER: STA SUL MKR. È il BQ24195L,
 * lo stesso che dal 3,7 V della cella tira su il 3V3 di tutto e il 5 V
 * dei LED. Il cavetto a due pin fra il carrier e il connettore batteria
 * del MKR non è un accessorio: è l'unica strada che la cella ha per
 * arrivargli, e senza quel cavetto non si carica nulla. Il rame lo dice
 * (`schermo/README.md`, «La batteria»): la rete VBAT tocca il
 * portabatteria e quel connettore, e nello zoccolo del MKR non entra.
 *
 * Quindi sì: USB attaccata, cella che carica. Ma solo se i registri del
 * caricabatterie dicono la cosa giusta, e all'accensione non è detto:
 *
 *   - il core di Arduino (`variants/mkrwifi1010/variant.cpp`) accende la
 *     carica solo se all'avvio vede una batteria — `analogRead(ADC_BATTERY)
 *     > 600` — e se non la vede STACCA la cella dal resto. Accendere con
 *     il cavetto scollegato e attaccarlo dopo vorrebbe dire USB che
 *     alimenta e cella che non carica, fino al riavvio;
 *   - il limite di corrente in ingresso vale 100 mA di suo, perché sul
 *     MKR i fili D+/D− non arrivano al caricabatterie e la trattativa con
 *     il caricatore non si fa. Il telecomando col vetro accesso mangia
 *     più di 100 mA: a quel limite la cella non carica, al massimo dà una
 *     mano all'USB a tenere su la scheda;
 *   - `carrier.begin()` accende la boost mode — è lei che fa il 5 V dei
 *     LED quando si va a batteria — e tocca lo stesso registro della
 *     carica.
 *
 * Quindi non si spera: si scrivono. E poi SI LEGGE LO STATO e si disegna
 * quello che c'è, non quello che dovrebbe esserci: un fulmine disegnato
 * perché «l'USB è attaccata, quindi starà caricando» è la bugia che si
 * scopre con la cella scarica in mano.
 * =================================================================== */
const uint8_t CARICATORE  = 0x6B;   // il BQ24195L, sullo stesso bus dei sensori
const uint8_t R_INGRESSO  = 0x00;   // quanta corrente si può prendere dall'USB
const uint8_t R_MODO      = 0x01;   // carica sì/no, boost sì/no
const uint8_t R_CORRENTE  = 0x02;   // quanta ne va nella cella
const uint8_t R_TIMER     = 0x05;   // il guardiano e il timer di sicurezza
const uint8_t R_CELLA     = 0x07;   // la cella attaccata o staccata
const uint8_t R_STATO     = 0x08;   // che cosa sta succedendo davvero
const uint8_t R_GUASTO    = 0x09;   // i guasti, che restano agganciati

bool caricatoreScrivi(uint8_t reg, uint8_t v) {
  Wire.beginTransmission(CARICATORE);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

bool caricatoreLeggi(uint8_t reg, uint8_t* v) {
  Wire.beginTransmission(CARICATORE);
  Wire.write(reg);
  /* `false`: si tiene il bus e si legge di seguito, che è il modo in cui
     il BQ24195L vuole essere letto. */
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(CARICATORE, (uint8_t)1) != 1) return false;
  *v = Wire.read();
  return true;
}

void impostaCaricatore() {
  Wire.begin();

  /* 0x32 — ingresso fino a 500 mA, che è quello che una porta USB dà per
     contratto senza chiedere niente a nessuno; soglia di tensione 4,36 V
     (se l'USB cede sotto, il caricabatterie si tira indietro da sé invece
     di far cadere la scheda); HIZ spento. */
  caricatoreScrivi(R_INGRESSO, 0x32);

  /* 0x3B — CARICA ACCESA E BOOST ACCESA INSIEME. Non litigano, e non è
     una scommessa: il BQ24195L carica quando l'ingresso c'è e fa il 5 V
     quando l'ingresso non c'è, perché la boost chiede l'ingresso assente
     per partire. Scriverlo qui vuol dire che il telecomando non dipende
     da che cosa ha lasciato nel registro `carrier.begin()`. Minimo di
     sistema 3,5 V, come lo mette il core di Arduino. */
  caricatoreScrivi(R_MODO, 0x3B);

  /* 0x00 — 512 mA, il minimo che il registro sappia dire (di suo
     sarebbero 2048, che su questa catena non ha senso: in serie alla
     cella, sul MKR, dovrebbe esserci un fusibile da mezzo ampere — lo
     dicono gli sviluppatori del core, sul rame non è verificato).
     Quelli veri sono
     meno: dai 500 mA dell'ingresso bisogna togliere quello che la scheda
     si mangia mentre carica, quindi stiamo sui 350. Una 18650 da 3000 mAh
     a 350 mA è un decimo di C: lenta, dieci ore da vuota, e mite — che su
     una cella senza circuito di protezione proprio è la scelta giusta. */
  caricatoreScrivi(R_CORRENTE, 0x00);

  /* 0x8C — il guardiano SPENTO e il timer di sicurezza a 12 ore.
     Il guardiano, se acceso, rimette i registri come li trova di fabbrica
     dopo 40 secondi senza che nessuno gli scriva: vorrebbe dire boost
     spenta (LED morti a batteria) e ingresso di nuovo a 100 mA, ogni 40
     secondi. Il timer invece resta acceso ma a 12 ore e non a 8: a 350 mA
     una cella da 3000 non ce la fa in otto ore, e un timer che scade
     mentre la carica va bene è un guasto che non c'è. */
  caricatoreScrivi(R_TIMER, 0x8C);

  /* 0x0B — cella attaccata, niente trattativa D+/D− (se la facesse,
     riscriverebbe il limite che abbiamo appena messo), interrupt sui
     guasti. È il valore che scrive il core di Arduino quando la batteria
     la vede: lo rimettiamo noi perché noi la cella ce l'abbiamo sempre,
     anche quando all'avvio il convertitore non l'ha vista. */
  caricatoreScrivi(R_CELLA, 0x0B);

  /* Riletti e stampati: è il modo di accorgersi che il bus non risponde
     senza aspettare che lo dica la cella scarica. */
  Serial.print("Caricatore:");
  uint8_t v;
  const uint8_t quali[] = { R_INGRESSO, R_MODO, R_CORRENTE, R_TIMER,
                            R_CELLA, R_STATO, R_GUASTO };
  for (int i = 0; i < 6; i++) {
    Serial.print(" 0x"); Serial.print(quali[i], HEX); Serial.print('=');
    if (caricatoreLeggi(quali[i], &v)) { Serial.print("0x"); Serial.print(v, HEX); }
    else Serial.print("muto");
  }
  Serial.println();
}

unsigned long ultimaSpina = 0, ultimaProva = 0, ultimoRiscritto = 0;
uint8_t guasto = 0;

/* ===================================================================
 * LA PROVA DELLA SPINA: SI MOLLA LA BOOST PER GUARDARE
 *
 * Al banco, il 2026-11-01: alimentatore da muro attaccato, e il
 * telecomando non se ne accorgeva — nessun fulmine, cioè PG_STAT giù,
 * cioè «non vedo nessun ingresso buono». Premendo il reset con
 * l'alimentatore già infilato, invece, partiva a caricare.
 *
 * LA CAUSA È NOSTRA. A batteria il 5 V dei LED lo fa il PMIC stesso con
 * la boost, e la boost PILOTA IL FILO VBUS — lo stesso filo su cui arriva
 * l'alimentatore. Un alimentatore da muro che regola a 5,0 V esatti non
 * sovrasta un'uscita boost che sta cinque centesimi più su: il PMIC non
 * vede niente di nuovo e resta in boost, dove PG è zero per definizione.
 * La porta del PC invece è dura, con i suoi condensatori, e lo sovrasta.
 * E noi peggioravamo le cose: la boost la ri-armavamo proprio quando
 * vedevamo `A_BATTERIA`, cioè esattamente nello stato sbagliato — si
 * teneva su da sé.
 *
 * L'unico modo di guardare è TOGLIERSI DI MEZZO: si molla la boost per
 * ottanta millisecondi e si rilegge PG. Se un alimentatore c'è, in quegli
 * ottanta millisecondi è lui a tenere su il filo e PG si alza — e il 5 V
 * non cala nemmeno, perché ci pensa l'alimentatore. Se non c'è, il 5 V
 * resta giù per ottanta millisecondi e si ri-arma.
 *
 * Il prezzo è quel buio, e si paga solo quando non c'è niente attaccato.
 * Per questo si prova spesso (otto secondi) quando i LED sono spenti, e
 * quasi mai (un minuto) quando sono accesi, dove si vedrebbe. E i LED
 * vanno RISCRITTI dopo: sono LED intelligenti, il colore ce l'hanno
 * dentro, e senza il 5 V se lo dimenticano.
 * =================================================================== */
/* IL MODO GIUSTO ADESSO, e sta in un posto solo perché sbagliarlo costa
   la carica. Con la spina dentro: carica sì, boost NO — chiedere la boost
   con un alimentatore attaccato vuol dire chiedere al PMIC di pilotare lo
   stesso filo da cui gli arriva la corrente. Senza spina: boost sì, che è
   l'unico modo di avere il 5 V dei LED.

   Il 1° novembre la finestra rimetteva `0x3B` anche alla spina, copiato da
   `impostaCaricatore()` dove ha senso (lì si scrive una volta, senza sapere
   se la spina c'è). Risultato: dopo la prima finestra la carica si fermava
   e il vetro diceva «attaccata ma non carica». */
uint8_t modoGiusto() { return allaSpina() ? 0x1B : 0x3B; }

bool provaSpina() {
  caricatoreScrivi(R_MODO, 0x1B);        // carica sì, boost no: filo libero
  delay(80);
  uint8_t r = 0;
  bool buono = caricatoreLeggi(R_STATO, &r) && (r & 0x04);
  if (!buono) {
    caricatoreScrivi(R_MODO, 0x3B);
    if (ledAccesi) accendiLed(schermoDisegnato);
  }
  return buono;
}

void leggiSpina(bool subito) {
  /* Due secondi e non dieci come la carica: la percentuale si muove in
     mezz'ora, la spina si muove quando la infili, e aspettare dieci
     secondi per vedere comparire il fulmine sembra un fulmine rotto. */
  if (!subito && millis() - ultimaSpina < 2000) return;
  ultimaSpina = millis();

  /* Prima di leggere lo stato, si prova: vedi sopra. Si prova solo da
     `A_BATTERIA`, perché è l'unico stato in cui la boost è armata e
     l'unico in cui il PMIC può avere una spina davanti senza vederla. */
  if (spina == A_BATTERIA) {
    unsigned long ogni = ledAccesi ? 60000 : 8000;
    if (subito || millis() - ultimaProva >= ogni) {
      ultimaProva = millis();
      provaSpina();
    }
  }

  /* I guasti stanno in un registro a parte e ci RESTANO AGGANCIATI finché
     non lo si legge: il valore che arriva è quello di prima della lettura,
     non quello di adesso. Si stampa solo quando cambia, e serve a capire
     che cosa dice il PMIC quando si litiga un filo con un alimentatore. */
  uint8_t gu;
  if (caricatoreLeggi(R_GUASTO, &gu) && gu != guasto) {
    guasto = gu;
    Serial.print("Caricatore guasto: 0x"); Serial.println(gu, HEX);
  }

  uint8_t r;
  if (!caricatoreLeggi(R_STATO, &r)) { spina = A_BATTERIA; return; }
  bool corrente = (r & 0x04) != 0;        // l'ingresso è buono
  uint8_t c = (r >> 4) & 0x03;            // 0 ferma, 1 pre-carica, 2 carica, 3 finita
  Spina ora = !corrente ? A_BATTERIA : c == 0 ? FERMA : c == 3 ? PIENA : IN_CARICA;

  /* QUANDO LA SPINA SE NE VA, SI RIMETTE LA BOOST. Al banco, il
     2026-11-01, il registro del modo riletto subito dopo averlo scritto
     diceva 0x1B e non 0x3B: con l'ingresso buono il bit della boost non
     resta su — e ha senso, perché la boost serve solo quando l'ingresso
     non c'è. Ma vuol dire che staccando l'USB a telecomando acceso il 5 V
     dei LED non si riaccenderebbe da sé fino al riavvio. Costa una
     scrittura e si fa qui, nel momento esatto in cui serve. */
  /* FERMA NON DEVE DURARE. «La spina c'è e la cella non carica» è giusto
     farlo vedere, ma se DURA non è quasi mai un guasto della cella: è un
     registro nostro rimasto storto — il 1° novembre era la finestra. Si
     riscrive il modo, non più di una volta ogni dieci secondi, e si dice
     sul seriale che si è fatto: se il guasto è vero, FERMA torna e quella
     riga lo racconta invece di nasconderlo. */
  if (ora == FERMA) {
    if (ultimoRiscritto == 0 || millis() - ultimoRiscritto >= 10000) {
      caricatoreScrivi(R_MODO, 0x1B);
      uint8_t m = 0;
      caricatoreLeggi(R_MODO, &m);
      ultimoRiscritto = millis() | 1;
      Serial.print("Ferma: modo riscritto, ora 0x"); Serial.println(m, HEX);
    }
    /* E qui la cella non eroga niente — la scheda la tiene l'USB — quindi
       `leggiCarica` può misurare: è una lettura a corrente zero, buona
       come quella della finestra. Ma il filtro riparte, perché quello che
       ha in pancia viene da prima della spina. */
    if (spina != FERMA) { vFiltrata = -1; piccoGrezzo = 0; }
  } else {
    ultimoRiscritto = 0;
  }

  if (ora == A_BATTERIA && spina != A_BATTERIA) {
    caricatoreScrivi(R_MODO, 0x3B);
    /* E il filtro della carica riparte da zero: quello che ha in pancia è
       la tensione di dieci minuti di carica fa, e mescolarla alla prima
       lettura a batteria farebbe scendere il numero a gradini per un
       quarto di minuto. `batteria` invece si tiene: è giusto. */
    vFiltrata = -1;
    piccoGrezzo = 0;
  }

  /* Si scrive sul seriale quando cambia QUELLO CHE SI VEDE, non a ogni
     giro di carica: vedi `pittura`. */
  if (pittura(ora) != pittura(spina) || subito) {
    Serial.print("Spina: ");
    Serial.println(ora == A_BATTERIA ? "a batteria" :
                   ora == IN_CARICA  ? "in carica" :
                   ora == PIENA      ? "carica finita" :
                                       "attaccata ma non carica");
  }
  spina = ora;
}

/* ===================================================================
 * LA FINESTRA A CARICA FERMA
 *
 * Mentre carica, la tensione sul connettore NON È la tensione della
 * cella: è la cella più la corrente di carica per tutta la resistenza che
 * sta in mezzo. Mezzo ampere su mezz'ohm fa due decimi e mezzo di volt, e
 * su un fondo scala di 0,85 V sono trenta punti percentuali inventati.
 * Misurarla meglio non si può, e filtrarla non serve: è un offset, non un
 * disturbo. Il filtro lo segue e lo mostra, come ha fatto al banco
 * saltando da 35 a 89.
 *
 * L'unico modo è SPEGNERE QUELLO CHE DISTURBA. Si ferma la carica per
 * trecento millisecondi, si misura, si riparte. A corrente ferma non
 * entra e non esce niente dalla cella, e quello che si legge è la
 * tensione a vuoto — che è la misura PIÙ PULITA di tutto il sistema,
 * meglio ancora di quella a batteria, dove il vetro e il WiFi tirano.
 * Niente si spegne nel frattempo: il 3V3 e il 5 V li tiene l'USB.
 *
 * Tre decimi di secondo bastano perché il pezzo che se ne va è quello
 * resistivo, e quello se ne va subito. Quello che resta — la cella che si
 * rilassa piano — vale pochi millivolt e ci mette minuti: aspettarlo
 * vorrebbe dire fermare la carica per minuti.
 *
 * E questa È anche lo strumento di taratura: a corrente zero, il numero
 * stampato qui e il tester sulla cella misurano la STESSA COSA. È il
 * punto che mancava fra 1,284 e 1,312.
 * =================================================================== */
unsigned long ultimaFinestra = 0;
float vFinestra = -1;
const unsigned long OGNI_FINESTRA = 20000;

void finestra(bool subito) {
  if (!allaSpina() || spina == FERMA) { vFinestra = -1; return; }
  if (!subito && millis() - ultimaFinestra < OGNI_FINESTRA) return;
  ultimaFinestra = millis();

  caricatoreScrivi(R_MODO, 0x0B);        // carica ferma, boost ferma
  delay(300);
  int g = 0;
  for (int i = 0; i < 8; i++) {
    int x = analogRead(ADC_BATTERY);
    if (x > g) g = x;
  }
  caricatoreScrivi(R_MODO, modoGiusto());
  /* E SI RILEGGE. Qui una scrittura che non attacca non si vede sul vetro
     per quattro secondi e costa tutta la carica: il registro si stampa
     accanto alla misura, così la riga dice se è ripartita davvero. */
  uint8_t m = 0;
  caricatoreLeggi(R_MODO, &m);
  if (ledAccesi) accendiLed(schermoDisegnato);

  float v = g * (3.3 / 1023.0) * K_PARTITORE;
  /* Mezzo e mezzo, e la prima volta si prende per buona: qui non c'è
     niente da filtrare via, solo il rumore del convertitore. */
  vFinestra = (vFinestra < 0) ? v : vFinestra + (v - vFinestra) * 0.5;

  int pc = (int)(100.0 * (vFinestra - V_VUOTA) / (V_PIENA - V_VUOTA));
  batteria = pc < 0 ? 0 : (pc > 100 ? 100 : pc);

  Serial.print("Finestra: grezzo "); Serial.print(g);
  Serial.print("  cella "); Serial.print(v);
  Serial.print(" V  -> "); Serial.print(batteria);
  Serial.print("%  modo 0x"); Serial.println(m, HEX);
}

/* UNA FINESTRA LUNGA, A RICHIESTA. Trecento millisecondi sono giusti per
   misurare e impossibili da acchiappare col tester in mano. Si scrive un
   carattere qualsiasi nel monitor seriale e la carica si ferma per cinque
   secondi, stampando mezzo secondo per volta: tutto il tempo di appoggiare
   le punte sulla cella e leggere i due numeri NELLO STESSO ISTANTE, che è
   l'unico modo di tarare — il primo tentativo, 1,233, sbagliava di quattro
   punti proprio perché i due numeri venivano da due momenti diversi.

   Vale anche a batteria, e lì fa una cosa in più: spegnendo la boost
   spegne i LED, cioè una parte del carico, e la cella si avvicina alla
   tensione a vuoto. Non ci arriva — il vetro e il WiFi tirano comunque —
   ma meno di prima.

   Cinque secondi di `delay` fermano i pad e le richieste del SLICER:
   è un comando da banco e si rifiuta mentre la macchina lavora. */
void finestraLunga() {
  while (Serial.available()) Serial.read();
  if (schermoOra != ATTESA && schermoOra != PRONTA) {
    Serial.println("Non adesso: la macchina sta lavorando.");
    return;
  }
  Serial.println("Carica ferma per 5 s: tester sulla cella, adesso.");
  caricatoreScrivi(R_MODO, 0x0B);
  for (int i = 0; i < 10; i++) {
    delay(500);
    int g = 0;
    for (int k = 0; k < 8; k++) {
      int x = analogRead(ADC_BATTERY);
      if (x > g) g = x;
    }
    Serial.print("  "); Serial.print((i + 1) * 500);
    Serial.print(" ms: grezzo "); Serial.print(g);
    Serial.print("  con K="); Serial.print(K_PARTITORE);
    Serial.print(" fa "); Serial.print((float)(g * (3.3 / 1023.0) * K_PARTITORE));
    Serial.println(" V");
  }
  caricatoreScrivi(R_MODO, modoGiusto());
  uint8_t m = 0;
  caricatoreLeggi(R_MODO, &m);
  if (ledAccesi) accendiLed(schermoDisegnato);
  ultimaFinestra = millis();
  Serial.print("Carica ripresa, modo 0x"); Serial.println(m, HEX);
}

/* ===================================================================
 * IL LIBRO DI BORDO
 *
 * Una riga per stampa sulla micro SD, scritta A FINE STAMPA e non a ogni
 * messaggio: una scrittura ogni 400 ms consumerebbe la scheda per
 * riscrivere ottanta volte lo stesso numero.
 * La data la manda il SLICER, perché qui un orologio che sopravviva a una
 * batteria scarica non c'è.
 * =================================================================== */
void scriviRegistro() {
  File f = SD.open("stampe.csv", FILE_WRITE);
  if (!f) return;
  f.print(S.data); f.print(';');
  f.print(S.nome); f.print(';');
  f.print(S.stato); f.print(';');
  f.println(S.percento);
  f.close();
}

/* ===================================================================
 * LEGGERE IL MESSAGGIO
 *
 * Non è un parser JSON: è un cercatore di campi in un messaggio che
 * scriviamo noi, con `JSON.stringify`, e di cui conosciamo la forma. Un
 * parser vero vorrebbe un'altra libreria e qualche kB di RAM che qui non
 * avanzano. Il confine, dichiarato: NON gestisce oggetti annidati oltre
 * `penna`, né virgolette dentro ai valori che non siano protette da una
 * barra rovescia. Se il messaggio cambiasse forma, cambia anche questo.
 * =================================================================== */
const char* trova(const char* corpo, const char* chiave) {
  static char cercato[20];
  snprintf(cercato, sizeof(cercato), "\"%s\":", chiave);
  const char* p = strstr(corpo, cercato);
  return p ? p + strlen(cercato) : nullptr;
}

void stringaDa(const char* corpo, const char* chiave, char* out, size_t n) {
  out[0] = 0;
  const char* p = trova(corpo, chiave);
  if (!p || *p != '"') return;
  p++;
  size_t i = 0;
  while (*p && *p != '"' && i < n - 1) {
    if (*p == '\\' && p[1]) p++;
    /* Il font ha 95 caratteri: quello che non c'è diventa un punto,
       invece di un geroglifico. Il «·» dei nomi dei livelli è il caso
       normale, non un'eccezione. */
    out[i++] = (*p >= 32 && *p < 127) ? *p : '.';
    p++;
  }
  out[i] = 0;
}

long numeroDa(const char* corpo, const char* chiave, long senza) {
  const char* p = trova(corpo, chiave);
  if (!p) return senza;
  if (!strncmp(p, "null", 4)) return senza;
  return atol(p);
}

bool booleanoDa(const char* corpo, const char* chiave) {
  const char* p = trova(corpo, chiave);
  return p && !strncmp(p, "true", 4);
}

/* Vero, falso, oppure NON LO DICE: tre cose diverse. Un booleano che
   schiaccia `null` su `false` farebbe scrivere «ABBASSA» a un telecomando
   che non sa dove sia la penna, cioè una bugia detta con sicurezza. */
int treStati(const char* corpo, const char* chiave) {
  const char* p = trova(corpo, chiave);
  if (!p) return -1;
  if (!strncmp(p, "true", 4)) return 1;
  if (!strncmp(p, "false", 5)) return 0;
  return -1;
}

void leggiMessaggio(const char* corpo) {
  char prima[10];
  strncpy(prima, S.stato, sizeof(prima));
  int passoPrima = S.passo;

  stringaDa(corpo, "stato", S.stato, sizeof(S.stato));
  stringaDa(corpo, "nome", S.nome, sizeof(S.nome));
  stringaDa(corpo, "macchina", S.macchina, sizeof(S.macchina));
  stringaDa(corpo, "data", S.data, sizeof(S.data));
  S.percento  = (int)numeroDa(corpo, "percento", -1);
  S.rimanente = numeroDa(corpo, "rimanente", -1);
  S.passo     = (int)numeroDa(corpo, "passo", -1);
  /* IL VOLUME ARRIVA IN OGNI MESSAGGIO, e va bene cosi': qui non c'e' un
     posto dove ricordarselo fra un'accensione e l'altra, e mandarlo una
     volta sola vorrebbe dire che staccando la spina torna al massimo senza
     dirlo a nessuno. Un SLICER vecchio non lo manda e vale 10, cioe' come
     prima. Cambiandolo si rifa' la strada alla prima nota. */
  int vol = (int)numeroDa(corpo, "volume", 10);
  if (vol < 0) vol = 0;
  if (vol > 10) vol = 10;
  if (vol != volumeCicalino) {
    volumeCicalino = vol;
    Serial.print("Volume cicalino: "); Serial.println(vol);
  }
  S.azzerata  = booleanoDa(corpo, "azzerata");
  S.giu       = treStati(corpo, "giu");

  /* `foglio` e' un oggetto come `penna`: si entra li' dentro. Assente o
     null vuol dire «non lo dice», e si azzerano tutt'e due -- un numero
     rimasto da prima sarebbe peggio di nessun numero. */
  S.foglioN = 0;
  S.foglioDi = 0;
  const char* pf = trova(corpo, "foglio");
  if (pf && *pf == '{') {
    S.foglioN  = (int)numeroDa(pf, "n", 0);
    S.foglioDi = (int)numeroDa(pf, "di", 0);
  }

  /* `penna` è un oggetto: si entra lì dentro e si prende il colore. */
  S.penna[0] = 0;
  const char* p = trova(corpo, "penna");
  if (p && *p == '{') stringaDa(p, "colore", S.penna, sizeof(S.penna));

  ultimoMessaggio = millis();
  bool primo = mai;
  mai = false;

  /* I SUONI SONO QUATTRO CAMBI DI STATO, e lo stato c'è già nel
     messaggio: non serve un campo apposta. */
  if (!primo && strcmp(prima, S.stato)) {
    if (!strcmp(S.stato, "invio") && strcmp(prima, "pausa") && strcmp(prima, "cambio")) {
      SUONA(SUONO_PARTENZA);
      sveglia();
    } else if (!strcmp(S.stato, "cambio")) {
      SUONA(SUONO_PENNA);
      ARMA(SUONO_PENNA, RICHIAMO_PENNA, 0);
      sveglia();
    } else if (!strcmp(S.stato, "fine")) {
      SUONA(SUONO_FINE);
      sveglia();
      scriviRegistro();
    } else if (!strcmp(S.stato, "fermata")) {
      SUONA(SUONO_STOP);
      sveglia();
      scriviRegistro();
    } else if (!strcmp(S.stato, "errore")) {
      SUONA(SUONO_ERRORE);
      ARMA(SUONO_ERRORE, RICHIAMO_ERRORE, ALLARME_PER);
      sveglia();
      scriviRegistro();
    }
    /* Cambiando stato il richiamo di prima non vale più: se il nuovo stato
       non è quello che l'ha armato, si spegne. */
    if (strcmp(S.stato, richiamoStato)) fermaRichiamo();

    /* Lo stop è arrivato a destinazione: la schermata di passaggio può
       andarsene. Vale per QUALUNQUE stato che non sia una stampa in corso,
       non solo per «fermata»: se la stampa è finita nel frattempo, o se
       è saltata per un errore, «FERMO» ha comunque smesso di essere vero. */
    if (strcmp(S.stato, "invio") && strcmp(S.stato, "pausa") &&
        strcmp(S.stato, "cambio")) fermandoDa = 0;

    /* E il racconto comincia adesso: tre minuti e il vetro torna Pronta.
       `raccontoChiuso` si rimette a false QUI e non altrove: lo stato e'
       cambiato, quindi quello che si era chiuso riguardava la stampa di
       prima. Senza questa riga, chiuso una volta il racconto, la fine
       della stampa dopo non si vedrebbe mai piu'. */
    raccontaDa = (!strcmp(S.stato, "fine") || !strcmp(S.stato, "fermata"))
                 ? millis() : 0;
    raccontoChiuso = false;
  }
  if (S.passo != passoPrima) sveglia();
}

/* ===================================================================
 * IL SERVER
 *
 * Il browser, prima di un POST con corpo JSON, manda un OPTIONS per
 * chiedere il permesso: è il «preflight» del CORS, e se non gli si
 * risponde il POST non parte nemmeno. Non è un dettaglio da aggiungere
 * dopo — senza, il telecomando sembra morto pur essendo acceso.
 * =================================================================== */
/* Le intestazioni HTTP non hanno maiuscole fisse, e `strncasecmp` non è
   garantito su ogni core: tre righe e non ci si pensa più. */
bool iniziaCon(const char* riga, const char* basso) {
  for (int i = 0; basso[i]; i++) {
    char c = riga[i];
    if (c >= 'A' && c <= 'Z') c += 32;
    if (c != basso[i]) return false;
  }
  return true;
}

void intestazioniCors(WiFiClient& c) {
  c.println("Access-Control-Allow-Origin: *");
  c.println("Access-Control-Allow-Methods: POST, OPTIONS");
  c.println("Access-Control-Allow-Headers: Content-Type");
  c.println("Access-Control-Max-Age: 86400");
}

char corpo[640];

void serviCliente() {
  WiFiClient c = server.available();
  if (!c) return;

  char riga[96];
  int n = 0, lunghezza = 0;
  bool post = false, vuota = false;
  unsigned long fino = millis() + 1500;

  /* L'intestazione, riga per riga. Si guarda solo quello che serve: il
     verbo e quanto è lungo il corpo. */
  while (c.connected() && millis() < fino) {
    if (!c.available()) { delay(1); continue; }
    char ch = c.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      riga[n] = 0;
      if (n == 0) { vuota = true; break; }
      if (!strncmp(riga, "POST", 4)) post = true;
      if (iniziaCon(riga, "content-length:")) lunghezza = atoi(riga + 15);
      n = 0;
    } else if (n < (int)sizeof(riga) - 1) {
      riga[n++] = ch;
    }
  }

  if (!post) {
    /* OPTIONS, o qualunque altra cosa: si risponde e basta. */
    c.println("HTTP/1.1 204 No Content");
    intestazioniCors(c);
    c.println("Connection: close");
    c.println();
    delay(2);
    c.stop();
    return;
  }

  if (vuota && lunghezza > 0) {
    int presi = 0;
    int massimo = min(lunghezza, (int)sizeof(corpo) - 1);
    while (presi < massimo && c.connected() && millis() < fino) {
      if (!c.available()) { delay(1); continue; }
      corpo[presi++] = c.read();
    }
    corpo[presi] = 0;
    leggiMessaggio(corpo);
  }

  /* LA RISPOSTA PORTA INDIETRO IL TASTO. È l'unico verso che il
     telecomando ha per parlare, ed è il motivo per cui non gli serve
     conoscere nessun indirizzo. */
  /* E anche la spina, con la stessa parola che il telecomando stampa sul
     monitor seriale: il SLICER non la deduce dalla percentuale — che mentre
     carica è gonfia — e può dirlo accanto alla pila. */
  const char* comeVa = spina == A_BATTERIA ? "batteria" :
                       spina == IN_CARICA  ? "carica"   :
                       spina == PIENA      ? "piena"    : "ferma";
  /* Il volume torna indietro perche' il cursore del SLICER possa dire la
     VERITA' invece della propria ultima idea: se il messaggio non e' mai
     arrivato, i due numeri non coincidono e si vede. */
  char risposta[128];
  if (daMandare[0]) snprintf(risposta, sizeof(risposta),
                             "{\"tasto\":\"%s\",\"batteria\":%d,\"carica\":\"%s\","
                             "\"volume\":%d}",
                             daMandare, batteria, comeVa, volumeCicalino);
  else              snprintf(risposta, sizeof(risposta),
                             "{\"tasto\":null,\"batteria\":%d,\"carica\":\"%s\","
                             "\"volume\":%d}",
                             batteria, comeVa, volumeCicalino);
  daMandare[0] = 0;

  c.println("HTTP/1.1 200 OK");
  c.println("Content-Type: application/json");
  intestazioniCors(c);
  c.print("Content-Length: "); c.println(strlen(risposta));
  c.println("Connection: close");
  c.println();
  c.print(risposta);
  delay(2);
  c.stop();
}

/* ===================================================================
 * I TASTI
 * =================================================================== */
void leggiTasti(Schermata s) {
  carrier.Buttons.update();

  /* QUALUNQUE PAD ZITTISCE IL RICHIAMO, anche uno che non è un tasto.
     Sulla schermata del problema non c'è NESSUN tasto vivo — non c'è
     niente da premere, la macchina è ferma — quindi senza questo la
     sirena non si potrebbe spegnere stando alla macchina, e toccare il
     vetro non farebbe niente mentre il coso urla. Vale anche sul cambio
     penna, dove toccare voleva già dire «sono arrivato».
     Si guarda `getTouch` e non `onTouchDown`: il livello si può leggere
     quante volte si vuole, mentre consumare un fronte qui rischierebbe di
     mangiare la pressione al tasto vero, due righe più sotto. */
  if (richiamo) {
    for (int k = 0; k < 5; k++)
      if (carrier.Buttons.getTouch((touchButtons)k)) { fermaRichiamo(); break; }
  }

  Tasto t[MAX_TASTI];
  int q = tastiDi(s, t);

  /* Lo stop in due tempi. Il primo tocco non ferma niente: chiede. */
  if (armato) {
    bool giuTieni = carrier.Buttons.getTouch(padDi(BASSO_DX));
    if (s == STOP_ARMATO && carrier.Buttons.onTouchDown(padDi(BASSO))) {
      armato = false; tenendo = false; attesaRilascio = false; sveglia();
      return;
    }
    if (attesaRilascio) {
      if (!giuTieni) attesaRilascio = false;
    } else if (giuTieni) {
      if (!tenendo) { tenendo = true; tenutoDa = millis(); tenutaDisegnata = -1; }
      else if (millis() - tenutoDa >= TENUTA_MS) {
        manda("stop");
        fermandoDa = millis();       // da qui il vetro dice FERMO, non STAMPA
        armato = false; tenendo = false; attesaRilascio = false;
        schermoDisegnato = NESSUNA;
        sveglia();
      }
    } else if (tenendo) {
      /* Mollato prima: non succede niente, e si torna alla domanda. */
      tenendo = false;
      schermoDisegnato = NESSUNA;
    }
    if (!tenendo && millis() - armatoDa > ARMATO_MS) { armato = false; attesaRilascio = false; }
    return;
  }

  for (int i = 0; i < q; i++) {
    if (!carrier.Buttons.onTouchDown(padDi(t[i].dove))) continue;
    sveglia();
    fermaRichiamo();                 // sei arrivato: il richiamo smette
    if (t[i].chiude) {
      /* Non si manda niente al SLICER: il racconto e' roba del vetro, e
         il SLICER di questa schermata non sa nulla — continuera' a dire
         «fine» finche' non parte un'altra stampa. */
      raccontoChiuso = true;
      schermoDisegnato = NESSUNA;
    } else if (t[i].manda[0]) {
      manda(t[i].manda);
    } else {
      /* L'unico tasto senza parola da mandare è STOP, che qui non manda
         niente: arma la domanda. */
      armato = true; tenendo = false; armatoDa = millis();
      attesaRilascio = true;
      schermoDisegnato = NESSUNA;
    }
    canta(RISONANZA);
    delay(8);                        // un tic, giusto per sentire il dito
    taci();
    return;
  }
}

/* ===================================================================
 * AVVIO
 * =================================================================== */
/* Aspettare facendo avanzare il cicalino: un `delay()` secco qui vorrebbe
   dire che il saluto dell'accensione non si sente, perché le note le fa
   avanzare il giro principale. */
void aspetta(unsigned long ms) {
  unsigned long fino = millis() + ms;
  while (millis() < fino) { suoni(); delay(5); }
}

void mostraAvvio(const char* riga1, const char* riga2) {
  carrier.display.fillScreen(NERO);
  scrivi(riga1, 100, corpoCheCiSta(riga1, 100, 2), TESTO);
  if (riga2[0]) scrivi(riga2, 130, corpoCheCiSta(riga2, 130, 2), FIOCO);
}

void setup() {
  Serial.begin(9600);
  /* NIENTE `while (!Serial)`: il telecomando deve partire anche attaccato
     a un caricabatterie, dove un monitor seriale non si aprirà mai. */

  carrier.noCase();
  /* `begin()` torna false se UN SENSORE QUALSIASI non risponde — qualità
     dell'aria, pressione, luce. Al telecomando i sensori non servono: un
     telecomando che non parte per via del sensore di qualità dell'aria
     sarebbe una sciocchezza. Si guarda il valore e si tira dritto. */
  if (!carrier.begin()) Serial.println("Carrier: qualche sensore non risponde (non importa).");

  pinMode(TFT_BACKLIGHT, OUTPUT);
  luce(255);
  sveglia();

  carrier.display.setRotation(2);
  carrier.display.fillScreen(NERO);

  /* Dopo `carrier.begin()`, che la boost mode l'ha già accesa: qui si
     rimette in chiaro tutto il resto. Vedi «LA SPINA». */
  impostaCaricatore();
  /* LA SPINA PRIMA DELLA CARICA, e non viceversa come fino al
     2026-11-01: `leggiCarica` deve sapere se è il caso di misurare o se
     tocca alla finestra. Nell'ordine sbagliato, accendere con l'USB
     infilata dava il numero gonfio della carica — gli 89% del banco. */
  leggiSpina(true);
  if (allaSpina() && spina != FERMA) finestra(true);
  else                               leggiCarica(true);

  mostraAvvio("collego", SEGRETO_SSID);
  WiFi.begin(SEGRETO_SSID, SEGRETO_PASSWORD);
  unsigned long fino = millis() + 25000;
  while (WiFi.status() != WL_CONNECTED && millis() < fino) {
    delay(400);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    IPAddress ip = WiFi.localIP();
    snprintf(ipTesto, sizeof(ipTesto), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
    Serial.print("Telecomando su http://"); Serial.println(ipTesto);
    server.begin();
    /* L'indirizzo resta in vista qualche secondo: è l'unica cosa che
       bisogna copiare a mano, e cercarla dopo vuol dire riaccendere. */
    mostraAvvio("sono qui", ipTesto);
    SUONA(SUONO_PARTENZA);
    aspetta(2500);
  } else {
    strncpy(ipTesto, "niente rete", sizeof(ipTesto));
    mostraAvvio("niente rete", SEGRETO_SSID);
    aspetta(2500);
  }

  strcpy(S.stato, "fermo");
  S.percento = -1; S.rimanente = -1; S.passo = -1; S.giu = -1;
  schermoDisegnato = NESSUNA;
}

void loop() {
  serviCliente();

  /* Se la rete cade, il telecomando si rimette in piedi da solo: una
     stampa dura venti minuti e nessuno sta lì a riavviarlo. */
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long riprova = 0;
    if (millis() - riprova > 10000) {
      riprova = millis();
      WiFi.begin(SEGRETO_SSID, SEGRETO_PASSWORD);
      if (WiFi.status() == WL_CONNECTED) {
        IPAddress ip = WiFi.localIP();
        snprintf(ipTesto, sizeof(ipTesto), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
        /* Il socket in ascolto non sopravvive alla caduta: rimetterlo è
           quello che distingue «torna da sé» da «sembra tornato». */
        server.begin();
        schermoDisegnato = NESSUNA;
      }
    }
  }

  /* IL DITO SI LEGGE PRIMA DI DECIDERE CHE SCHERMATA MOSTRARE.
     Premendo STOP la schermata cambia dentro a questo stesso giro:
     leggendo i tasti dopo aver deciso, si ridisegnava per intero la
     schermata di PRIMA — quella della stampa, anello compreso — e solo
     al giro dopo quella dello stop. Due schermate intere una dietro
     l'altra: è lo «sfarfallio, come se passasse prima per altre
     schermate» visto alla prima stampa vera, il 2026-10-31. */
  leggiTasti(quale());
  schermoOra = quale();
  suoni();
  leggiSpina(false);
  leggiCarica(false);
  finestra(false);
  if (Serial.available()) finestraLunga();
  gestisciLuce(schermoOra);

  /* Il richiamo: il cambio penna finché non vieni, il problema per tre
     minuti. Vedi «IL RICHIAMO». */
  richiama();

  /* La carica cambia senza che cambi schermata. Dove la pila si vede per
     intero — Pronta, e l'Attesa alla spina — si rinfresca DA SOLA, un
     pezzo di vetro alto diciotto pixel (vedi `aggiornaPezzi`): adesso che
     il numero si muove di un punto ogni due secondi, rifare la schermata
     intera sarebbe uno sfarfallio ogni due secondi. Altrove la pila
     compare solo sotto al 20%, cioè una volta per batteria, e lì rifare
     tutto non costa niente. */
  if (batteria != caricaDisegnata && schermoOra != PRONTA &&
      !(schermoOra == ATTESA && allaSpina()) &&
      (batteria < 20 || caricaDisegnata < 20)) {
    caricaDisegnata = batteria;
    schermoDisegnato = NESSUNA;
  }

  /* E la spina cambia da sé, mentre guardi: il fulmine deve comparire
     quando la infili e andarsene quando la togli, senza che si debba
     cambiare schermata per vederlo. */
  if (pittura(spina) != pitturaDisegnata) {
    pitturaDisegnata = pittura(spina);
    if (schermoOra == PRONTA || schermoOra == ATTESA || batteria < 20)
      schermoDisegnato = NESSUNA;
  }

  if (vetroDaRifare()) schermoDisegnato = NESSUNA;

  if (schermoOra != schermoDisegnato) {
    disegnaTutto(schermoOra);
    accendiLed(schermoOra);
    schermoDisegnato = schermoOra;
    azzerataDisegnata = S.azzerata;
    giuDisegnato = S.giu;
    caricaDisegnata = batteria;   // appena disegnata: non ridisegnarla subito
    strncpy(pennaDisegnata, S.penna, sizeof(pennaDisegnata) - 1);
    pennaDisegnata[sizeof(pennaDisegnata) - 1] = 0;
    foglioDisegnato = S.foglioN;
    pcDisegnato = -999;
    tenutaDisegnata = -1;
  } else {
    aggiornaPezzi(schermoOra);
  }
}
