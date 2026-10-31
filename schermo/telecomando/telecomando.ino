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

enum Posto { ALTO, ALTO_SX, ALTO_DX, BASSO_SX, BASSO_DX, NESSUNO };

struct Tasto { Posto dove; const char* parola; uint16_t colore; const char* manda; };
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
 * I CINQUE TASTI
 *
 * Numeri e posizioni vengono dagli schemi Altium del carrier, non dal
 * premerli: TOUCH2 è quello IN ALTO, 1 e 0 scendono a sinistra, 3 e 4 a
 * destra. Stanno a 60° uno dall'altro — cinque posti su sei, il vuoto in
 * basso — e il LED n è il LED del pad n.
 *
 * Se guardando la scheda i lati risultassero specchiati, si scambiano
 * qui dentro 0 con 4 e 1 con 3: il 2 resta in alto comunque, perché
 * l'insieme delle posizioni è simmetrico.
 * =================================================================== */
touchButtons padDi(Posto p) {
  switch (p) {
    case BASSO_SX: return TOUCH0;
    case ALTO_SX:  return TOUCH1;
    case ALTO:     return TOUCH2;
    case ALTO_DX:  return TOUCH3;
    default:       return TOUCH4;   // BASSO_DX
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
      out[0] = { ALTO,     "FATTO",    AMBRA, "avanti" };
      return 1;
    case PENNA2:
      out[0] = { ALTO,     "RIPRENDI", AMBRA, "riprendi" };
      out[1] = { BASSO_DX, "PROVA",    VERDE, "prova" };
      return 2;
    case STOP_ARMATO:
      out[0] = { ALTO,     "ANNULLA",  VERDE, "" };
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
 * cicalino è, non a che frequenza grida. Una spazzata da 1 a 6 kHz la
 * trova in dieci secondi (tieni premuto il pad in alto all'accensione).
 * Se cade altrove, si sposta QUESTO numero e l'ottava lo segue.
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

/* L'ANELLO. Adafruit_GFX non sa fare archi: si fa a raggi, uno ogni
   0,4°, che all'esterno distano meno di un pixel — quindi nessun buco.
   Gira dalle dodici in senso orario, come un orologio: è il verso in cui
   si legge un tempo che passa, e nessuno deve pensarci. */
void settore(float da, float a, uint16_t c) {
  if (a <= da) return;
  for (float g = da; g < a; g += 0.4) {
    float r = (g - 90.0) * DEG_TO_RAD;
    float co = cos(r), si = sin(r);
    carrier.display.drawLine(CX + R_INT * co, CY + R_INT * si,
                             CX + R_EST * co, CY + R_EST * si, c);
  }
}

float anelloDisegnato = -1;
uint16_t anelloColore = 0;

void anello(float pc, uint16_t c, bool rifai) {
  if (pc < 0) pc = 0;
  if (pc > 100) pc = 100;
  if (rifai || c != anelloColore) {
    settore(0, 360, SPENTO);
    settore(0, pc * 3.6, c);
  } else if (pc < anelloDisegnato) {
    /* Torna indietro: è il conto alla rovescia dello stop. Si spegne solo
       il pezzo che se n'è andato — ridisegnare tutto l'anello venti volte
       al secondo vorrebbe dire un anello che tremola invece di svuotarsi. */
    settore(pc * 3.6, anelloDisegnato * 3.6, SPENTO);
  } else if (pc > anelloDisegnato) {
    /* Solo il pezzo nuovo: ridisegnare tutto l'anello a ogni punto
       percentuale sarebbe un lampo ogni venti secondi, per niente. */
    settore(anelloDisegnato * 3.6, pc * 3.6, c);
  }
  anelloDisegnato = pc;
  anelloColore = c;
}

/* LO SPICCHIO del tocco lungo. È un oggetto DIVERSO dall'anello apposta:
   l'anello sta sul bordo e dice a che punto è la stampa, questo sta in
   mezzo e dice a che punto è il tuo dito. Confonderli vorrebbe dire far
   sembrare che la stampa stia tornando indietro. */
void spicchio(float f, int cx, int cy, int r, uint16_t c) {
  carrier.display.drawCircle(cx, cy, r + 5, c);
  if (f <= 0) return;
  for (float g = 0; g < f * 360.0; g += 0.5) {
    float a = (g - 90.0) * DEG_TO_RAD;
    carrier.display.drawLine(cx, cy, cx + r * cos(a), cy + r * sin(a), c);
  }
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
void etichetta(Posto p, const char* parola, uint16_t c) {
  int w = largo(parola, 2), h = alto(2);
  int x, y;
  if (p == ALTO) {
    x = CX - w / 2;
    y = CY - (int)sqrt(R_TESTI * R_TESTI - (w / 2.0) * (w / 2.0));
  } else {
    bool destra = (p == ALTO_DX || p == BASSO_DX);
    bool sotto  = (p == BASSO_SX || p == BASSO_DX);
    /* Troncati VERSO il centro: mezzo pixel in dentro non si vede, mezzo
       pixel in fuori finisce nell'anello. */
    int dx = (int)(R_TESTI * cos(30.0 * DEG_TO_RAD));   // 80
    int dy = (int)(R_TESTI * sin(30.0 * DEG_TO_RAD));   // 46
    x = destra ? (CX + dx) - w : (CX - dx);
    y = sotto  ? (CY + dy) - h : (CY - dy);
  }
  carrier.display.setTextSize(2);
  carrier.display.setTextColor(c);
  carrier.display.setCursor(x, y);
  carrier.display.print(parola);
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
      simboloPenna(90, VERDE, true);
      scrivi("MONTA", 118, 3, TESTO);
      pallino(S.penna, 156);
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
  for (int i = 0; i < q; i++) etichetta(t[i].dove, t[i].parola, t[i].colore);
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
      carrier.display.fillRect(40, 96, 160, 48, NERO);
      snprintf(n, sizeof(n), "%d%%", S.percento < 0 ? 0 : S.percento);
      scrivi(n, 96, 6, TESTO);
      carrier.display.fillRect(40, 174, 160, 16, NERO);
      scriviRimanente(174);
      pcDisegnato = S.percento;
    }
  } else if (s == IN_PAUSA) {
    anello(S.percento, AMBRA, false);
    if (S.percento != pcDisegnato) {
      carrier.display.fillRect(60, 174, 120, 16, NERO);
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
    if (f - tenutaDisegnata > 0.03) {
      spicchio(f, CX, 110, 46, ROSSO);
      tenutaDisegnata = f;
    }
  }
}

/* I LED: quello accanto a un tasto vivo si accende del colore di quello
   che il tasto fa. Piano — girano sul 5 V generato a bordo, quindi la
   luminosità costa più di quanto sembri, e questo coso sta a batteria. */
void accendiLed(Schermata s) {
  Tasto t[MAX_TASTI];
  int q = tastiDi(s, t);
  uint8_t r[5] = {0}, g[5] = {0}, b[5] = {0};
  for (int i = 0; i < q; i++) {
    int k = (int)padDi(t[i].dove);
    uint16_t c = t[i].colore;
    r[k] = ((c >> 11) & 0x1F) << 1;     // da RGB565 a qualcosa di fioco
    g[k] = ((c >> 5) & 0x3F);
    b[k] = (c & 0x1F) << 1;
  }
  for (int k = 0; k < 5; k++) carrier.leds.setPixelColor(k, r[k] / 4, g[k] / 4, b[k] / 4);
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
    if (s == STOP_ARMATO && carrier.Buttons.onTouchDown(padDi(ALTO))) {
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

  schermoOra = quale();
  leggiTasti(schermoOra);
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
