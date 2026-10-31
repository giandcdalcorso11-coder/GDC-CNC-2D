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
 *   POST /stato  { v, stato, nome, percento, rimanente, penna, passo,
 *                  macchina, azzerata, data }
 *     → 200      { "tasto": "riprendi", "batteria": 78 }
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
  char  stato[10];      // fermo | invio | pausa | cambio | fine | errore
  int   percento;       // 0..100, -1 = non c'è
  long  rimanente;      // millisecondi, -1 = il Sender non l'ha ancora misurato
  char  penna[10];      // "#rrggbb", vuoto = il livello non ha una tinta
  char  nome[28];       // il nome del lavoro: serve solo al libro di bordo
  int   passo;          // 0 o 1 nel cambio penna, -1 fuori
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
enum Schermata { PRONTA, STAMPA, IN_PAUSA, PENNA1, PENNA2,
                 STOP_ARMATO, STOP_TIENI, FINE, ERRORE, ATTESA, NESSUNA };

enum Posto { BASSO, ALTO_SX, ALTO_DX, BASSO_SX, BASSO_DX, NESSUNO };

/* `sotto` è la SECONDA RIGA, quando una parola sola non basta a dire che
   cosa fa il tasto. Sta in fondo apposta: le etichette di una riga si
   scrivono come prima e il campo resta vuoto da sé. */
struct Tasto { Posto dove; const char* parola; uint16_t colore;
               const char* manda; const char* sotto; };
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

Schermata quale() {
  if (armato)  return tenendo ? STOP_TIENI : STOP_ARMATO;
  if (!vivo()) return ATTESA;
  if (!strcmp(S.stato, "invio"))  return STAMPA;
  if (!strcmp(S.stato, "pausa"))  return IN_PAUSA;
  if (!strcmp(S.stato, "cambio")) return S.passo >= 1 ? PENNA2 : PENNA1;
  if (!strcmp(S.stato, "fine"))   return FINE;
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
      out[1] = { BASSO_DX, "ABBASSA", VERDE, "prova", "E ALZA" };
      return 2;
    case STOP_ARMATO:
      out[0] = { BASSO,    "ANNULLA",  VERDE, "" };
      out[1] = { BASSO_DX, "TIENI",    ROSSO, "" };
      return 2;
    case STOP_TIENI:
      out[0] = { BASSO_DX, "TIENI",    ROSSO, "" };
      return 1;
    default:
      return 0;   // Pronta, Finita, Errore, In attesa: nessun tasto vivo
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
 * RISONANZA È DA CONFERMARE A ORECCHIO: lo schema dice che tipo di
 * cicalino è, non a che frequenza grida. Si trova con una spazzata da 1
 * a 6 kHz — il banco di prova la fa fare al computer, qui dentro non
 * c'è. Se cade altrove, si sposta QUESTO numero e l'ottava lo segue.
 * =================================================================== */
const int RISONANZA = 4000;

/* Generati dal banco di prova, che li fa anche sentire. */
const Nota SUONO_PARTENZA[] = { {3520, 55}, {4186, 55}, {4699, 85} };
const Nota SUONO_PENNA[]    = { {4186, 70}, {0, 70}, {4186, 70} };
const Nota SUONO_FINE[]     = { {4186, 80}, {3520, 80}, {4186, 80},
                                {4699, 95}, {0, 55}, {4699, 300} };
const Nota SUONO_ERRORE[]   = { {4186, 450} };

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
  if (notaOra >= quanteNote) { carrier.Buzzer.noSound(); inSuono = nullptr; return; }
  notaDa = ora;
  if (inSuono[notaOra].hz) carrier.Buzzer.sound(inSuono[notaOra].hz);
  else                     carrier.Buzzer.noSound();
}

/* Il cambio penna è l'unico che si ripete: è l'unico in cui la macchina
   sta ASPETTANDO TE, e un suono che squilla una volta sola la lascia
   ferma un'ora se in quel momento eri in un'altra stanza. Smette appena
   tocchi un tasto, che vuol dire che sei arrivato. */
const unsigned long RICHIAMO_MS = 20000;
unsigned long ultimoRichiamo = 0;
bool richiamaAncora = false;

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
   è un dato ma un avviso. */
int batteria = -1;

uint16_t coloreCarica(int pc) {
  return pc < 20 ? ROSSO : pc < 40 ? AMBRA : SMORTO;
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
      pallino(S.penna, 74);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 96, 6, TESTO);
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
      scrivi(n, 174, 2, FIOCO);
      break;

    case PENNA1:
      anello(S.percento, AMBRA, true);
      simboloPenna(90, AMBRA, false);
      scrivi("TOGLI", 118, 3, TESTO);
      scrivi("LA PENNA", 146, 2, TESTO);
      break;

    case PENNA2:
      anello(S.percento, AMBRA, true);
      /* Tutto più in alto che nelle altre schermate: qui l'etichetta del
         tasto in basso a destra è di DUE righe, e il posto da cui prenderlo
         è la parte alta del vetro, che in questa schermata è vuota. */
      simboloPenna(76, VERDE, true);
      parolaEPallino("MONTA", S.penna, 104, 3, TESTO);
      break;

    case STOP_ARMATO:
      anello(100, ROSSO, true);
      simboloDivieto(80, ROSSO);
      scrivi("FERMARE?", 118, 3, TESTO);
      break;

    case STOP_TIENI:
      anello(100, ROSSO, true);
      break;

    case FINE:
      anello(100, VERDE, true);
      simboloSpunta(84, VERDE);
      scrivi("FATTO", 126, 3, TESTO);
      if (batteria >= 0 && batteria < 20) pila(batteria, 196, false);
      break;

    case ERRORE:
      anello(100, ROSSO, true);
      simboloAllarme(84, ROSSO);
      scrivi("FERMA", 126, 3, TESTO);
      if (batteria >= 0 && batteria < 20) pila(batteria, 196, false);
      break;

    case ATTESA:
      anello(0, SPENTO, true);
      simboloSenzaRete(70, FIOCO);
      scrivi("IN ATTESA", 126, 2, SMORTO);
      /* L'indirizzo è l'unica cosa utile da guardare qui: è quello da
         copiare nelle impostazioni del SLICER. */
      scrivi(ipTesto, 152, corpoCheCiSta(ipTesto, 152, 2), FIOCO);
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
/* NON BASTA SAPERE QUALE schermata c'è sul vetro: bisogna sapere anche
   che cosa ci era scritto sopra. Una macchina che viene azzerata resta
   sulla schermata PRONTA — cambia solo la riga sotto, da «da azzerare» a
   «al punto home» — e senza questo il vetro continuerebbe a dire quella
   vecchia finché non cambia schermata per altri motivi. Stessa storia per
   il pallino del colore, che arriva un attimo dopo l'inizio della stampa:
   il segno di penna sta nel G-code all'inizio del livello, cioè qualche
   millisecondo dopo che lo stato è diventato «invio». */
bool azzerataDisegnata = false;
char pennaDisegnata[10] = "";
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
      pulisci(174, 16);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 174, 2, FIOCO);
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

void accendiLed(Schermata s) {
  Tasto t[MAX_TASTI];
  int q = tastiDi(s, t);
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
                  s == STOP_ARMATO || s == STOP_TIENI);
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
const float K_PARTITORE = 2.0;       // da tarare: vedi sopra
const float V_VUOTA = 3.30, V_PIENA = 4.15;

unsigned long ultimaCarica = 0;

void leggiCarica(bool subito) {
  if (!subito && millis() - ultimaCarica < 10000) return;
  ultimaCarica = millis();
  long somma = 0;
  for (int i = 0; i < 8; i++) somma += analogRead(ADC_BATTERY);
  float grezzo = somma / 8.0;
  float v = grezzo * (3.3 / 1023.0) * K_PARTITORE;
  int pc = (int)(100.0 * (v - V_VUOTA) / (V_PIENA - V_VUOTA));
  batteria = pc < 0 ? 0 : (pc > 100 ? 100 : pc);
  if (subito) {
    Serial.print("ADC_BATTERY grezzo: "); Serial.print(grezzo);
    Serial.print("  con K="); Serial.print(K_PARTITORE);
    Serial.print(" fa "); Serial.print(v); Serial.println(" V");
  }
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
  S.azzerata  = booleanoDa(corpo, "azzerata");

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
      richiamaAncora = true;
      ultimoRichiamo = millis();
      sveglia();
    } else if (!strcmp(S.stato, "fine")) {
      SUONA(SUONO_FINE);
      sveglia();
      scriviRegistro();
    } else if (!strcmp(S.stato, "errore")) {
      SUONA(SUONO_ERRORE);
      sveglia();
      scriviRegistro();
    }
    if (strcmp(S.stato, "cambio")) richiamaAncora = false;
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
  char risposta[64];
  if (daMandare[0]) snprintf(risposta, sizeof(risposta),
                             "{\"tasto\":\"%s\",\"batteria\":%d}", daMandare, batteria);
  else              snprintf(risposta, sizeof(risposta),
                             "{\"tasto\":null,\"batteria\":%d}", batteria);
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
        armato = false; tenendo = false; attesaRilascio = false;
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
    richiamaAncora = false;          // sei arrivato: il richiamo smette
    if (t[i].manda[0]) {
      manda(t[i].manda);
    } else {
      /* L'unico tasto senza parola da mandare è STOP, che qui non manda
         niente: arma la domanda. */
      armato = true; tenendo = false; armatoDa = millis();
      attesaRilascio = true;
      schermoDisegnato = NESSUNA;
    }
    carrier.Buzzer.sound(RISONANZA);
    delay(8);                        // un tic, giusto per sentire il dito
    carrier.Buzzer.noSound();
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

  leggiCarica(true);

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
  S.percento = -1; S.rimanente = -1; S.passo = -1;
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
  leggiCarica(false);
  gestisciLuce(schermoOra);

  /* Il richiamo del cambio penna, finché non premi. */
  if (richiamaAncora && !strcmp(S.stato, "cambio") && !inSuono &&
      millis() - ultimoRichiamo > RICHIAMO_MS) {
    ultimoRichiamo = millis();
    SUONA(SUONO_PENNA);
  }

  /* La carica cambia senza che cambi schermata, e dove si vede va
     rinfrescata: sulla Pronta sempre, altrove solo quando è un avviso. */
  if (batteria != caricaDisegnata &&
      (schermoOra == PRONTA || batteria < 20 || caricaDisegnata < 20)) {
    caricaDisegnata = batteria;
    schermoDisegnato = NESSUNA;
  }

  if (S.azzerata != azzerataDisegnata || strcmp(S.penna, pennaDisegnata)) {
    schermoDisegnato = NESSUNA;
  }

  if (schermoOra != schermoDisegnato) {
    disegnaTutto(schermoOra);
    accendiLed(schermoOra);
    schermoDisegnato = schermoOra;
    azzerataDisegnata = S.azzerata;
    strncpy(pennaDisegnata, S.penna, sizeof(pennaDisegnata) - 1);
    pennaDisegnata[sizeof(pennaDisegnata) - 1] = 0;
    pcDisegnato = -999;
    tenutaDisegnata = -1;
  } else {
    aggiornaPezzi(schermoOra);
  }
}
