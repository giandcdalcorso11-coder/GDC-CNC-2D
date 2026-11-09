/* IL VETRO, DISEGNATO QUI INVECE CHE SULLA SCHEDA.
 *
 * Compila il firmware VERO contro un finto display che scrive in una
 * memoria, e salva una immagine per schermata. Serve a guardare quello che
 * il telecomando disegnera' PRIMA di caricarglielo: l'anello sfumato, i
 * rettangoli che cancellano, dove cascano le parole.
 *
 * Le lettere sono BLOCCHI e non lettere: il font di Adafruit_GFX non ce
 * l'abbiamo qui, e per guardare la geometria un blocco largo quanto la
 * lettera dice la stessa cosa. */
#include "telecomando_copia.ino"
#include <cstdio>
#include <cstring>

uint16_t FB[240 * 240];
static unsigned long OROLOGIO = 0;

static inline void punto(int x, int y, uint16_t c) {
  if (x >= 0 && x < 240 && y >= 0 && y < 240) FB[y * 240 + x] = c;
}
static uint16_t mescola(uint16_t c, float f) {
  int r = (int)(((c >> 11) & 0x1F) * f + 0.5);
  int g = (int)(((c >> 5) & 0x3F) * f + 0.5);
  int b = (int)((c & 0x1F) * f + 0.5);
  return (uint16_t)((r << 11) | (g << 5) | b);
}

void Gfx::drawPixel(int x, int y, uint16_t c) { punto(x, y, c); }
void Gfx::init(int, int) {}
void Gfx::setRotation(int) {}
void Gfx::fillScreen(uint16_t c) { for (int i = 0; i < 240 * 240; i++) FB[i] = c; }
void Gfx::drawFastHLine(int x, int y, int w, uint16_t c) { for (int i = 0; i < w; i++) punto(x + i, y, c); }
void Gfx::drawLine(int x0, int y0, int x1, int y1, uint16_t c) {
  int dx = abs(x1 - x0), dy = -abs(y1 - y0);
  int sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
  for (;;) {
    punto(x0, y0, c);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
void Gfx::fillRect(int x, int y, int w, int h, uint16_t c) {
  for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) punto(x + i, y + j, c);
}
void Gfx::drawRect(int x, int y, int w, int h, uint16_t c) {
  drawFastHLine(x, y, w, c); drawFastHLine(x, y + h - 1, w, c);
  for (int j = 0; j < h; j++) { punto(x, y + j, c); punto(x + w - 1, y + j, c); }
}
void Gfx::drawRoundRect(int x, int y, int w, int h, int, uint16_t c) { drawRect(x, y, w, h, c); }
void Gfx::drawCircle(int cx, int cy, int r, uint16_t c) {
  for (float g = 0; g < 360; g += 0.3) {
    float a = g * DEG_TO_RAD;
    punto((int)lround(cx + r * cos(a)), (int)lround(cy + r * sin(a)), c);
  }
}
void Gfx::fillCircle(int cx, int cy, int r, uint16_t c) {
  for (int y = -r; y <= r; y++) for (int x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) punto(cx + x, cy + y, c);
}
void Gfx::drawCircleHelper(int cx, int cy, int r, uint8_t q, uint16_t c) {
  for (float g = 0; g < 360; g += 0.3) {
    float a = g * DEG_TO_RAD;
    int x = (int)lround(cx + r * cos(a)), y = (int)lround(cy + r * sin(a));
    bool su = y < cy, dx2 = x > cx;
    if (((q & 1) && su && !dx2) || ((q & 2) && su && dx2)) punto(x, y, c);
  }
}
void Gfx::drawTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t c) {
  drawLine(x0, y0, x1, y1, c); drawLine(x1, y1, x2, y2, c); drawLine(x2, y2, x0, y0, c);
}
void Gfx::fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t c) {
  int ymin = min(y0, min(y1, y2)), ymax = max(y0, max(y1, y2));
  int xmin = min(x0, min(x1, x2)), xmax = max(x0, max(x1, x2));
  for (int y = ymin; y <= ymax; y++) for (int x = xmin; x <= xmax; x++) {
    float d1 = (x - x1) * (float)(y0 - y1) - (x0 - x1) * (float)(y - y1);
    float d2 = (x - x2) * (float)(y1 - y2) - (x1 - x2) * (float)(y - y2);
    float d3 = (x - x0) * (float)(y2 - y0) - (x2 - x0) * (float)(y - y0);
    bool neg = (d1 < 0) || (d2 < 0) || (d3 < 0), pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    if (!(neg && pos)) punto(x, y, c);
  }
}
static int T_K = 1, T_X = 0, T_Y = 0; static uint16_t T_C = 0xFFFF;
void Gfx::setTextSize(int k) { T_K = k; }
void Gfx::setTextColor(uint16_t c) { T_C = c; }
void Gfx::setCursor(int x, int y) { T_X = x; T_Y = y; }
void Gfx::print(const char* s) {
  for (int i = 0; s[i]; i++) {
    if (s[i] != ' ') {
      int w = 5 * T_K, h = 7 * T_K;
      for (int j = 0; j < h; j++) for (int q = 0; q < w; q++) {
        bool bordo = (j == 0 || j == h - 1 || q == 0 || q == w - 1);
        punto(T_X + q, T_Y + j, bordo ? T_C : mescola(T_C, 0.35));
      }
    }
    T_X += 6 * T_K;
  }
}
void Leds::setPixelColor(int, int, int, int) {}
void Leds::show() {}
bool Qtouch::update() { return true; }
int TOCCO_FINTO = -1;                /* quale pad e' toccato, -1 nessuno */
/* IL FRONTE, cioe' «premuto proprio adesso», e non il livello: e' quello
   che guardano i tasti veri (`onTouchDown` in `leggiTasti`), mentre
   `getTouch` lo guardano solo il richiamo e la tenuta dello stop. Finche'
   questo tornava sempre `false` nessuna prova poteva premere un tasto:
   si poteva collaudare quello che il vetro DISEGNA, non quello che fa un
   dito. Resta -1 quando nessuno lo tocca, quindi le prove scritte prima
   non cambiano di una virgola. */
int DOWN_FINTO = -1;
bool Qtouch::getTouch(touchButtons p) { return (int)p == TOCCO_FINTO; }
bool Qtouch::onTouchDown(touchButtons p) { return (int)p == DOWN_FINTO; }
bool Qtouch::onTouchUp(touchButtons) { return false; }
int BUZ_HZ = 0;                      /* l'ultima nota chiesta a tone() */
void Buz::sound(int f) { BUZ_HZ = f; }
void Buz::noSound() { BUZ_HZ = 0; }
void Buz::beep(int, unsigned long) {}
int MKRIoTCarrier::begin() { return 1; }
void MKRIoTCarrier::noCase() {} void MKRIoTCarrier::withCase() {}

unsigned long millis() { return OROLOGIO; }
void delay(unsigned long) {}
void pinMode(int, int) {} void digitalWrite(int, int) {} int digitalRead(int) { return 0; }
void analogWrite(int, int) {}
TccFinto TCC0_CORPO = {};
TccFinto* TCC0 = &TCC0_CORPO;
int ADC_FINTO = 512;                 /* il grezzo della cella, a scelta */
int analogRead(int) { return ADC_FINTO; }
void tone(int, int) {} void noTone(int) {}
void SerialeFinta::begin(long) {}
void SerialeFinta::print(const char*) {} void SerialeFinta::print(int) {}
void SerialeFinta::print(long) {} void SerialeFinta::print(float) {} void SerialeFinta::print(char) {}
void SerialeFinta::println(const char*) {} void SerialeFinta::println(int) {}
void SerialeFinta::println(long) {} void SerialeFinta::println(float) {} void SerialeFinta::println() {}
void SerialeFinta::print(int, int) {} void SerialeFinta::println(int, int) {}
SerialeFinta::operator bool() const { return false; }
WiFiClient::operator bool() const { return false; }
bool WiFiClient::connected() { return false; }
int WiFiClient::available() { return 0; }
int WiFiClient::read() { return -1; }
void WiFiClient::stop() {}
void WiFiClient::print(const char*) {} void WiFiClient::print(unsigned long) {}
void WiFiClient::println(const char*) {} void WiFiClient::println(unsigned long) {}
void WiFiClient::println() {}
WiFiServer::WiFiServer(int) {}
void WiFiServer::begin() {}
WiFiClient WiFiServer::available() { return WiFiClient(); }
int WiFiFinta::status() { return 0; }
void WiFiFinta::begin(const char*, const char*) {}
IPAddress WiFiFinta::localIP() { IPAddress a; a.v[0]=192; a.v[1]=168; a.v[2]=1; a.v[3]=77; return a; }
File::operator bool() const { return false; }
void File::print(const char*) {} void File::print(int) {} void File::print(char) {}
void File::println(int) {} void File::close() {}
bool SDFinta::begin(int) { return false; }
File SDFinta::open(const char*, int) { return File(); }
/* IL CARICABATTERIE FINTO: un registro, quello dello stato, e lo decide
   la prova. Il firmware ci arriva passando per il suo vero codice di
   lettura, quindi quello che si guarda nelle immagini e' il fulmine
   disegnato DOPO aver decodificato i bit, non uno acceso a mano. */
uint8_t PMIC_STATO_FINTO = 0x00;
uint8_t PMIC_REG[16] = {0};
static uint8_t REG_CHIESTO = 0;
static int QUANTI = 0;
void WireFinto::begin() {}
void WireFinto::beginTransmission(uint8_t) { QUANTI = 0; }
/* Il primo byte e' il registro, il secondo e' il valore: una scrittura si
   riconosce dal secondo. Senza questa distinzione non si poteva provare
   che la finestra RIMETTE la carica quando ha finito - che e' il modo in
   cui un bug qui lascerebbe la batteria a non caricare per sempre. */
void WireFinto::write(uint8_t v) {
  if (QUANTI == 0)            REG_CHIESTO = v;
  else if (REG_CHIESTO < 16)  PMIC_REG[REG_CHIESTO] = v;
  QUANTI++;
}
uint8_t WireFinto::endTransmission(bool) { return 0; }
uint8_t WireFinto::requestFrom(uint8_t, uint8_t n) { return n; }
int WireFinto::available() { return 1; }
uint8_t WireFinto::read() {
  if (REG_CHIESTO == R_STATO)  return PMIC_STATO_FINTO;
  if (REG_CHIESTO == R_GUASTO) return 0;
  return REG_CHIESTO < 16 ? PMIC_REG[REG_CHIESTO] : 0;
}
WireFinto Wire;

SerialeFinta Serial; SDFinta SD; WiFiFinta WiFi;

static void salva(const char* nome) {
  char p[128]; snprintf(p, sizeof(p), "%s.ppm", nome);
  FILE* f = fopen(p, "wb");
  fprintf(f, "P6\n240 240\n255\n");
  for (int i = 0; i < 240 * 240; i++) {
    uint16_t c = FB[i];
    unsigned char rgb[3] = { (unsigned char)(((c >> 11) & 0x1F) * 255 / 31),
                             (unsigned char)(((c >> 5) & 0x3F) * 255 / 63),
                             (unsigned char)((c & 0x1F) * 255 / 31) };
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
}

/* Quanti pixel accesi ci sono in una striscia alta `h` da `y`. Serve a
   provare che una riga di testo c'e' o NON c'e': di un disegno non si
   puo' chiedere molto di piu' senza ricopiarlo, ma «qui non e' scritto
   niente» e «qui c'e' scritto qualcosa» sono due fatti netti. */
/* Quanti pixel sono accesi su tutto il vetro. Di un disegno non si puo'
   chiedere molto di piu' senza ricopiarlo, ma «qui c'e' qualcosa in piu'»
   e «sono due disegni diversi» sono due fatti netti. */
static int accesi() {
  int n = 0;
  for (int i = 0; i < 240 * 240; i++) if (FB[i]) n++;
  return n;
}

/* Quanti pixel accesi in una fascia, dentro a una finestra orizzontale.
   Serve a dire «qui in mezzo non c'e' scritto niente», che e' il modo per
   provare che due righe non si toccano. */
static int accesiNellaFascia(int y, int h, int x0, int x1) {
  int n = 0;
  for (int r = y; r < y + h && r < 240; r++) {
    for (int c = x0; c < x1; c++) if (FB[r * 240 + c]) n++;
  }
  return n;
}

/* Quanti pixel, DENTRO al cerchio delle parole, non sono come dovevano.
   Fuori c'e' l'anello, che si disegna a pezzi di proposito. */
static int DIV_X0, DIV_Y0, DIV_X1, DIV_Y1;
static int diversiDentro(const uint16_t* atteso) {
  int n = 0;
  DIV_X0 = DIV_Y0 = 9999; DIV_X1 = DIV_Y1 = -1;
  for (int y = 0; y < 240; y++) {
    for (int x = 0; x < 240; x++) {
      float dx = x - 120.0f, dy = y - 120.0f;
      if (dx * dx + dy * dy > 93.0f * 93.0f) continue;
      if (FB[y * 240 + x] != atteso[y * 240 + x]) {
        n++;
        if (x < DIV_X0) DIV_X0 = x;
        if (y < DIV_Y0) DIV_Y0 = y;
        if (x > DIV_X1) DIV_X1 = x;
        if (y > DIV_Y1) DIV_Y1 = y;
      }
    }
  }
  return n;
}

static void schermata(Schermata s, const char* nome) {
  disegnaTutto(s);
  salva(nome);
}

/* I BIT DEL REGISTRO DELLO STATO, provati facendoli leggere al firmware
   invece di mettere a mano la variabile: bit 2 = la corrente c'e',
   bit 5-4 = 0 ferma, 1 pre-carica, 2 carica, 3 finita. */
static void spinaFinta(uint8_t reg, Spina atteso, const char* chi) {
  PMIC_STATO_FINTO = reg;
  leggiSpina(true);
  if (spina != atteso) {
    fprintf(stderr, "KO lo stato 0x%02X doveva dire %s\n", reg, chi);
    exit(1);
  }
}

int main() {
  strcpy(S.stato, "invio");
  S.percento = 67; S.rimanente = 190000; S.passo = 1;
  strcpy(S.penna, "#c8102e"); strcpy(S.nome, "biglietto.svg");
  strcpy(S.macchina, "Run"); S.azzerata = true;
  strcpy(ipTesto, "192.168.1.77");
  batteria = 76;

  schermata(PRONTA, "pronta");
  schermata(STAMPA, "stampa");

  /* ============ IL FOGLIO, QUANDO SONO PIU' D'UNO ============
     Con nove magneti sul piano, una percentuale che sale non dice se il
     terzo e' fatto o se si sta ancora al primo -- e con l'ordine per penna
     la punta ci torna sopra due volte. Con UN foglio invece non si scrive
     niente: «foglio 1 di 1» occuperebbe una riga di vetro per non
     distinguere niente. */
  disegnaTutto(STAMPA);
  int vuoto = accesi();
  S.foglioN = 3; S.foglioDi = 9;
  disegnaTutto(STAMPA);
  int pieno = accesi();
  /* Si contano i pixel accesi di TUTTO il vetro invece che di una fascia:
     scrivendo il foglio la schermata si rialza -- il pallino e la
     percentuale salgono di quattordici pixel per far posto -- quindi una
     fascia sola direbbe «e' cambiato» anche solo perche' il resto si e'
     spostato. La riga in piu' sono i suoi pixel in piu', e quelli non
     mentono. */
  if (pieno - vuoto < 80) {
    fprintf(stderr, "KO con nove fogli non scrive su che foglio sta "
                    "(%d pixel contro %d)\n", pieno, vuoto); exit(1);
  }
  /* UN FOGLIO DICHIARATO E' COME NESSUNO. «Foglio 1 di 1» occuperebbe una
     riga di vetro per non distinguere niente, e alzerebbe tutto il resto
     per fare posto a quella riga. Il banco non provava questo caso, e
     senza non c'e' differenza fra «dal secondo in poi» e «da uno in poi»:
     l'ha trovato il banco delle mutazioni. */
  S.foglioN = 1; S.foglioDi = 1;
  disegnaTutto(STAMPA);
  if (accesi() != vuoto) {
    fprintf(stderr, "KO «1 di 1» cambia la schermata: non scrive su che "
                    "foglio sta solo quando ce n'e' piu' d'uno\n"); exit(1);
  }
  S.foglioN = 3; S.foglioDi = 9;
  disegnaTutto(STAMPA);

  /* LA TARGHETTA DEL FOGLIO STA NELL'ANGOLO IN ALTO A DESTRA, dal
     2026-11-09, e questi controlli sono stati rifatti con lei: prima
     stava in mezzo, sotto la percentuale, e per starci alzava di
     quattordici pixel tutto quello che aveva sopra. Il conto non tornava
     — fra il bordo basso di PAUSA (90) e la riga del foglio (132) ci sono
     42 pixel e la percentuale a corpo 6 ne e' alta 48 — e sulla macchina
     la prima cifra finiva dentro alla parola PAUSA.

     PRIMO CORRIDOIO: fra la targhetta (e il pallino) e la percentuale.
     Cinque righe vuote da 91 a 95, per tutta la larghezza. */
  if (accesiNellaFascia(91, 5, 40, 200) != 0) {
    fprintf(stderr, "KO fra la targhetta del foglio e la percentuale non "
                    "c'e' corridoio\n"); exit(1);
  }
  /* E LA TARGHETTA C'E' DAVVERO, nell'angolo: senza questo il corridoio
     qui sopra sarebbe vuoto anche se la targhetta non si disegnasse per
     niente. */
  /* LA FINESTRA SI FERMA A 196 E NON A 205, ed e' tutta la differenza fra
     un controllo e una decorazione: oltre quel bordo, a questa altezza,
     comincia l'ANELLO (raggio 95,5), che e' acceso sempre. Con la
     finestra larga fino a 205 questa riga contava i pixel dell'anello e
     non sarebbe mai stata zero: passava anche con la targhetta disegnata
     in mezzo al vetro. L'ha trovato il banco delle mutazioni, il
     2026-11-09, un'ora dopo averla scritta. */
  if (accesiNellaFascia(74, 16, 150, 196) == 0) {
    fprintf(stderr, "KO la targhetta del foglio non e' nell'angolo in alto "
                    "a destra\n"); exit(1);
  }

  schermata(STAMPA, "stampa-foglio");

  /* IL NUMERO CAMBIA SENZA CHE CAMBI LA SCHERMATA, ed e' il caso che con
     l'ordine per penna capita di continuo: se il vetro si rifacesse solo
     al cambio di schermata, resterebbe «3/9» fino alla fine della stampa. */
  /* SECONDO CORRIDOIO: sotto la percentuale e sopra l'etichetta del tasto
     STOP, che sta nella fascia 150-166 a destra di x=154. Il numero grande
     finisce a 144: quattro righe vuote fra i due. */
  if (accesiNellaFascia(145, 4, 40, 200) != 0) {
    fprintf(stderr, "KO fra la percentuale e l'etichetta dello STOP non c'e' "
                    "corridoio\n");
    exit(1);
  }
  /* E LA PERCENTUALE NON TOCCA L'ETICHETTA PAUSA, che e' il difetto vero
     del 2026-11-09: PAUSA occupa la fascia 74-90 a sinistra di x=98, e la
     prima cifra del numero ci finiva dentro. Il corridoio di sopra lo
     dice gia' per la sua fascia; questo guarda proprio l'angolo. */
  if (accesiNellaFascia(82, 9, 40, 98) == 0) {
    fprintf(stderr, "KO l'etichetta PAUSA non c'e' piu': il controllo "
                    "guarderebbe un angolo vuoto\n"); exit(1);
  }

  /* ============ AGGIORNARE NON E' RIDISEGNARE A META' ============
   *
   * Il 2026-11-09, con due fogli sul piano: «la schermata con il cerchio
   * e la % era frammentata, come se ci fossero due numeri uno sopra
   * l'altro». Era vero: il disegno intero metteva la percentuale a 82 —
   * alzata di quattordici pixel per far posto alla riga del foglio, fase
   * 3d dello Step 12 — e l'aggiornamento del solo numero la ripuliva e la
   * riscriveva a 96, dove stava PRIMA di quella fase. Restava la cima del
   * numero vecchio, e quello nuovo finiva sulla riga del foglio.
   *
   * LA REGOLA, ed e' piu' generale del difetto: dopo un aggiornamento il
   * vetro deve essere IDENTICO a come lo disegnerebbe un giro intero.
   * Qualunque cosa si muova, se le due strade non dicono la stessa cosa
   * una delle due ha torto. */
  {
    S.foglioN = 3; S.foglioDi = 9;
    S.percento = 41;
    disegnaTutto(STAMPA);
    static uint16_t ATTESO[240 * 240];
    memcpy(ATTESO, FB, sizeof(ATTESO));

    S.percento = 37;
    disegnaTutto(STAMPA);
    pcDisegnato = 37;
    S.percento = 41;
    aggiornaPezzi(STAMPA);

    /* SI GUARDA DENTRO AL CERCHIO DELLE PAROLE, raggio 93, e l'anello
       resta fuori apposta: l'anello si disegna A PEZZI di proposito — solo
       il settore nuovo, per non farlo tremolare a ogni punto percentuale —
       quindi sul suo bordo le due strade danno qualche pixel diverso ed e'
       giusto cosi'. Dentro, invece, non c'e' niente che si possa
       permettere di essere diverso. */
    int diversi = diversiDentro(ATTESO);
    if (diversi) {
      salva("stampa-aggiornata");
      fprintf(stderr, "KO aggiornando la percentuale il vetro non torna "
                      "come lo disegnerebbe un giro intero: %d pixel diversi "
                      "fra x %d-%d e y %d-%d (vedi fuori/stampa-aggiornata.ppm)\n",
              diversi, DIV_X0, DIV_X1, DIV_Y0, DIV_Y1);
      exit(1);
    }

    /* E con UN foglio solo, dove la percentuale sta piu' in basso, deve
       valere lo stesso: le due quote sono due, e un controllo su una sola
       non direbbe niente dell'altra. */
    S.foglioN = 0; S.foglioDi = 0;
    S.percento = 41;
    disegnaTutto(STAMPA);
    memcpy(ATTESO, FB, sizeof(ATTESO));
    S.percento = 37;
    disegnaTutto(STAMPA);
    pcDisegnato = 37;
    S.percento = 41;
    aggiornaPezzi(STAMPA);
    diversi = diversiDentro(ATTESO);
    if (diversi) {
      fprintf(stderr, "KO con un foglio solo l'aggiornamento lascia %d "
                      "pixel diversi\n", diversi);
      exit(1);
    }
    S.foglioN = 3; S.foglioDi = 9; S.percento = 67;
    disegnaTutto(STAMPA);
  }

  /* I NUMERI ARRIVANO DAVVERO NELLA SCRITTA. Il vetro finto disegna
     BLOCCHI al posto delle lettere (vedi l'intestazione di questo file),
     quindi «3» e «4» sono identici per costruzione e confrontarli non
     proverebbe niente: due disegni uguali sarebbero una conseguenza del
     banco, non del codice. Quello che il banco PUO' vedere e' la
     LARGHEZZA -- «3/12» e' un carattere piu' lungo di «3/9» -- e quella
     cambia solo se i numeri finiscono davvero nella stringa. */
  S.foglioDi = 12;
  disegnaTutto(STAMPA);
  if (accesi() <= pieno) {
    fprintf(stderr, "KO «3/12» non e' piu' lungo di «3/9»: i numeri non "
                    "arrivano nella scritta\n"); exit(1);
  }
  /* IL VETRO SI RIFA' QUANDO IL FOGLIO CAMBIA, e non e' scontato: il
     foglio cambia restando in «invio», cioe' SENZA cambiare schermata, e
     il vetro si ridisegna da capo solo quando la schermata cambia. Senza
     questo il numero resterebbe quello di prima fino alla fine della
     stampa. */
  azzerataDisegnata = S.azzerata;
  giuDisegnato = S.giu;
  foglioDisegnato = S.foglioN;
  strncpy(pennaDisegnata, S.penna, sizeof(pennaDisegnata) - 1);
  if (vetroDaRifare()) {
    fprintf(stderr, "KO il vetro vuole rifarsi quando non e' cambiato niente\n");
    exit(1);
  }
  S.foglioN = 7;
  if (!vetroDaRifare()) {
    fprintf(stderr, "KO il foglio cambia e il vetro non si rifa'\n"); exit(1);
  }

  S.foglioN = 0; S.foglioDi = 0;
  schermata(IN_PAUSA, "pausa");
  schermata(PENNA1, "penna1");
  /* Le DUE facce del montaggio: il tasto dice l'azione, quindi la parola
     cambia a seconda di dove sta il servo. */
  S.giu = 1; schermata(PENNA2, "penna2");          // penna gia' al contatto: ALZA
  S.giu = 0; schermata(PENNA2, "penna2-su");       // penna alzata: ABBASSA
  S.giu = 1;
  /* Il terzo passo: la punta della penna nuova da ritrovare sul foglio. */
  schermata(PENNA3, "penna3");
  schermata(STOP_ARMATO, "armato");
  S.percento = 62;
  schermata(FERMATA, "fermata");
  schermata(FERMANDO, "fermando");
  S.percento = 67;
  schermata(FINE, "fine");
  /* E la FERMATA, che fino al 2026-11-09 non si disegnava: era
     l'unica schermata di cui nessuno aveva mai guardato il ritratto,
     ed e' una di quelle che adesso porta un tasto. */
  { int pc = S.percento; S.percento = 43;
    schermata(FERMATA, "fermata"); S.percento = pc; }
  schermata(ERRORE, "errore");
  schermata(ATTESA, "attesa");

  /* LA PILA CHE SI MUOVE DA SOLA: la schermata non si rifa', si cancella
     una striscia alta diciotto pixel e si ridisegna la pila. Qui si parte
     da 90 e si scende a 73 un punto per volta, come fa il firmware: se la
     striscia fosse stretta resterebbero i pezzi del numero di prima. */
  batteria = 100;              // quattro caratteri: il 73 ne ha tre, e se la
  disegnaTutto(PRONTA);        // striscia e' stretta resta un pezzo di '%'
  caricaDisegnata = 100;
  for (int b = 99; b >= 73; b--) { batteria = b; aggiornaPezzi(PRONTA); }
  salva("pronta-73");
  batteria = 76;

  /* LA SPINA. Prima i bit, poi le due schermate dove il fulmine si vede:
     la Pronta (sempre) e l'Attesa (solo alla spina), con la carica a meta'
     cosi' si guarda il fulmine bianco mezzo sopra al pieno e mezzo sopra
     al nero - che e' il motivo per cui e' bianco. */
  spinaFinta(0x00, A_BATTERIA, "a batteria");
  spinaFinta(0x04, FERMA,      "attaccata ma non carica");
  spinaFinta(0x34, PIENA,      "carica finita");
  spinaFinta(0x24, IN_CARICA,  "in carica");
  batteria = 46;
  schermata(PRONTA, "pronta-carica");
  schermata(ATTESA, "attesa-carica");
  batteria = 76;
  spinaFinta(0x00, A_BATTERIA, "a batteria");

  /* LA PROVA DELLA SPINA. Senza ingresso buono si deve RI-ARMARE la boost
     (altrimenti i LED restano spenti); con l'ingresso buono si deve
     LASCIARLA GIU' (altrimenti si litiga il filo con l'alimentatore, che
     e' il difetto del 2026-11-01: la presa a muro non veniva vista). */
  PMIC_STATO_FINTO = 0x00; PMIC_REG[R_MODO] = 0x3B;
  if (provaSpina()) { fprintf(stderr, "KO la prova vede una spina che non c'e'\n"); exit(1); }
  if (PMIC_REG[R_MODO] != 0x3B) {
    fprintf(stderr, "KO la prova non ha ri-armato la boost: 0x%02X\n", PMIC_REG[R_MODO]); exit(1);
  }
  PMIC_STATO_FINTO = 0x04;
  if (!provaSpina()) { fprintf(stderr, "KO la prova non vede la spina\n"); exit(1); }
  if (PMIC_REG[R_MODO] != 0x1B) {
    fprintf(stderr, "KO la boost e' tornata su con la spina attaccata: 0x%02X\n", PMIC_REG[R_MODO]); exit(1);
  }

  /* LA FINESTRA A CARICA FERMA. Due cose, e la seconda e' quella che
     lascerebbe la batteria a secco per sempre se saltasse. */
  PMIC_STATO_FINTO = 0x24;            // in carica
  leggiSpina(true);
  ADC_FINTO = 893;                    // 3,69 V di cella, cioe' 46%
  vFinestra = -1; finestra(true);
  if (batteria != 46) {
    fprintf(stderr, "KO la finestra ha letto %d%% invece di 46\n", batteria); exit(1);
  }
  /* 0x1B e NON 0x3B: con la spina dentro la boost deve restare giu'.
     Chiederla e' il difetto del 1'' novembre - la carica si fermava e il
     vetro diceva "attaccata ma non carica". */
  if (PMIC_REG[R_MODO] != 0x1B) {
    fprintf(stderr, "KO la finestra ha lasciato il modo a 0x%02X\n", PMIC_REG[R_MODO]); exit(1);
  }

  /* E ALLA SPINA IL NUMERO NON LO FA `leggiCarica`. Col grezzo gonfio
     della carica (1000 su 1023, cioe' il 100% finto) il numero deve
     restare dov'e': e' il difetto del banco, 35% che saltava a 89. */
  batteria = 46; ADC_FINTO = 1000;
  for (int i = 0; i < 50; i++) { OROLOGIO += 100; leggiCarica(false); }
  if (batteria != 46) {
    fprintf(stderr, "KO la tensione di carica e' entrata nel numero: %d%%\n", batteria); exit(1);
  }

  ADC_FINTO = 512; PMIC_STATO_FINTO = 0x00; leggiSpina(true);
  vFiltrata = -1; batteria = 76;

  /* IL VOLUME DEL CICALINO. Due strade, e la differenza non si sente: un
     volume che sbaglia il PERIODO cambierebbe la NOTA, e ascoltando un
     cicalino nessuno direbbe «questa e' 2380 invece di 2500». I numeri si
     guardano, non si ascoltano. */
  volumeCicalino = 10; modoCicalino = 0; BUZ_HZ = 0;
  canta(2500);
  if (modoCicalino != 1 || BUZ_HZ != 2500) {
    fprintf(stderr, "KO a volume pieno non passa piu' da tone(): modo %d, hz %d\n",
            modoCicalino, BUZ_HZ); exit(1);
  }

  volumeCicalino = 5; canta(2500);
  if (modoCicalino != 2) { fprintf(stderr, "KO sotto il pieno non passa al PWM\n"); exit(1); }
  /* 48 MHz diviso 2500 fa 19200 conteggi per periodo: PER e' uno meno. */
  if (TCC0->PER.reg != 19199) {
    fprintf(stderr, "KO il periodo e' %lu invece di 19199: la nota sarebbe sbagliata\n",
            TCC0->PER.reg); exit(1);
  }
  /* Tacca 5 su 10 = un quarto di periodo alto (il massimo utile e' meta'). */
  if (TCC0->CC[7].reg != 4800) {
    fprintf(stderr, "KO la parte alta e' %lu invece di 4800\n", TCC0->CC[7].reg); exit(1);
  }

  volumeCicalino = 1; canta(2500);
  if (TCC0->CC[7].reg != 960) {
    fprintf(stderr, "KO alla tacca 1 la parte alta e' %lu invece di 960\n",
            TCC0->CC[7].reg); exit(1);
  }
  /* E la nota non deve cambiare col volume: il periodo resta quello. */
  if (TCC0->PER.reg != 19199) {
    fprintf(stderr, "KO il volume ha cambiato la nota: periodo %lu\n", TCC0->PER.reg); exit(1);
  }

  /* Un'altra nota, per vedere che il periodo segua lei e non il volume. */
  canta(1873);
  if (TCC0->PER.reg != (unsigned long)(48000000UL / 1873 - 1)) {
    fprintf(stderr, "KO il periodo non segue la nota: %lu\n", TCC0->PER.reg); exit(1);
  }

  volumeCicalino = 0; canta(2500);
  if (TCC0->CC[7].reg != 0) {
    fprintf(stderr, "KO a zero non tace: parte alta %lu\n", TCC0->CC[7].reg); exit(1);
  }

  /* ============ IL TIMER CHE NON RISPONDE ============
     Qui c'era un `while (TCC0->SYNCBUSY.reg) { }` senza uscita, e il
     2026-11-09 e' costato una stampa: col volume a 2 il telecomando si e'
     piantato dentro al suono della partenza, il vetro e' rimasto sulla
     schermata di prima e il modulo WiFi ha continuato ad accettare
     connessioni a cui nessuno rispondeva.

     SE IL CODICE TORNA ROTTO QUESTO CONTROLLO NON FALLISCE: SI PIANTA.
     E' l'unico modo di provare un'uscita che non c'e', e il banco delle
     mutazioni se ne accorge lo stesso perche' aspetta ogni prova con un
     tempo massimo. */
  volumeCicalino = 2;
  pwmRotto = false;
  modoCicalino = 0;
  BUZ_HZ = 0;
  TCC0->SYNCBUSY.reg = 1;            /* il timer non si sincronizza piu' */
  canta(2500);
  TCC0->SYNCBUSY.reg = 0;
  if (!pwmRotto) {
    fprintf(stderr, "KO il timer non rispondeva e il firmware non se n'e' accorto\n");
    exit(1);
  }
  if (BUZ_HZ != 2500) {
    fprintf(stderr, "KO caduto il PWM, il cicalino e' rimasto muto invece di "
                    "suonare pieno: hz %d\n", BUZ_HZ); exit(1);
  }
  /* E DA LI' IN POI TUTTI I VOLUMI SUONANO PIENI: la nota dopo non deve
     tornare a provare il PWM e ripiantarsi.

     SI GUARDA IL REGISTRO, non la nota: dopo la caduta il suono esce
     pieno in tutt'e due i casi — anche riprovando il PWM si finisce in
     `tornaATone`, che suona lo stesso. L'unica differenza visibile e' che
     il periodo viene RISCRITTO, cioe' che ci ha riprovato. Il primo giro
     di questo controllo guardava la nota e passava anche col codice
     rotto. */
  TCC0->SYNCBUSY.reg = 1;
  BUZ_HZ = 0;
  TCC0->PER.reg = 0;
  canta(2227);
  TCC0->SYNCBUSY.reg = 0;
  if (TCC0->PER.reg != 0) {
    fprintf(stderr, "KO dopo la caduta riprova il PWM: ha riscritto il "
                    "periodo a %lu\n", TCC0->PER.reg); exit(1);
  }
  if (BUZ_HZ != 2227 || modoCicalino != 1) {
    fprintf(stderr, "KO dopo la caduta il cicalino non suona: hz %d, modo %d\n",
            BUZ_HZ, modoCicalino); exit(1);
  }
  volumeCicalino = 10; pwmRotto = false; modoCicalino = 0; taci();
  volumeCicalino = 10; modoCicalino = 0; BUZ_HZ = 0;

  /* LO SFARFALLIO DOPO LO STOP. Tenuto il dito, il telecomando manda
     «stop» — ma per due giri di messaggi `S.stato` vale ancora «invio», e
     prima qui si rimetteva la schermata della stampa in corso: anello,
     percentuale, tutto. E' quello che l'utente ha visto il 2026-11-02.
     Finche' la risposta non torna, il vetro deve dire FERMO. */
  OROLOGIO = 500000;
  strcpy(S.stato, "invio"); S.percento = 62;
  /* `quale()` dice ATTESA se il SLICER non si fa sentire: qui si finge che
     il messaggio sia appena arrivato, se no la prova misurerebbe quello. */
  mai = false; ultimoMessaggio = OROLOGIO;
  armato = false; tenendo = false; fermandoDa = 0; raccontaDa = 0;
  if (quale() != STAMPA) { fprintf(stderr, "KO non parte dalla stampa\n"); exit(1); }
  fermandoDa = OROLOGIO;                      /* come fa `manda("stop")` */
  if (quale() != FERMANDO) {
    fprintf(stderr, "KO dopo lo stop il vetro torna alla stampa\n"); exit(1);
  }
  /* E non ci resta per sempre: se il comando si perde, dopo sei secondi si
     torna a dire quello che si sa. */
  OROLOGIO += 7000; ultimoMessaggio = OROLOGIO;
  if (quale() != STAMPA) {
    fprintf(stderr, "KO «fermo» non scade: un comando perso bloccherebbe il vetro\n");
    exit(1);
  }

  /* IL RACCONTO SCADE. «Fatta» e «fermata» restano finche' non parte la
     stampa dopo: va bene per dieci minuti, non per la mattina dopo. */
  strcpy(S.stato, "fermata"); fermandoDa = 0; raccontaDa = OROLOGIO;
  if (quale() != FERMATA) { fprintf(stderr, "KO non mostra la fermata\n"); exit(1); }
  OROLOGIO += RACCONTO_MS + 1000; ultimoMessaggio = OROLOGIO;
  if (quale() != PRONTA) {
    fprintf(stderr, "KO dopo tre minuti racconta ancora la fermata\n"); exit(1);
  }
  strcpy(S.stato, "fine"); raccontaDa = OROLOGIO;
  if (quale() != FINE) { fprintf(stderr, "KO non mostra la fine\n"); exit(1); }
  OROLOGIO += RACCONTO_MS + 1000; ultimoMessaggio = OROLOGIO;
  if (quale() != PRONTA) {
    fprintf(stderr, "KO dopo tre minuti racconta ancora la fine\n"); exit(1);
  }
  /* ============ IL TASTO CHE CHIUDE IL RACCONTO ============
     Chiesto dall'operatore il 2026-11-09: dopo la fine o l'annullamento
     di una stampa si deve poter tornare alla schermata base con un tasto,
     invece di aspettare i tre minuti. Le due strade convivono: la
     scadenza e' per chi passa domani, il tasto per chi e' li' adesso. */
  raccontoChiuso = false;
  strcpy(S.stato, "fine"); raccontaDa = OROLOGIO; ultimoMessaggio = OROLOGIO;
  if (quale() != FINE) { fprintf(stderr, "KO la fine non si vede\n"); exit(1); }

  /* UN PAD QUALUNQUE NON CHIUDE NIENTE. Il tasto e' uno, scritto sul
     vetro: se bastasse un pad qualsiasi, appoggiare il telecomando sul
     tavolo cancellerebbe il racconto senza che nessuno l'abbia letto. */
  DOWN_FINTO = (int)padDi(BASSO_DX);
  leggiTasti(FINE);
  DOWN_FINTO = -1;
  if (quale() != FINE) {
    fprintf(stderr, "KO un pad qualunque chiude il racconto\n"); exit(1);
  }

  /* E IL TASTO LO CHIUDE. */
  daMandare[0] = 0;
  DOWN_FINTO = (int)padDi(ALTO_SX);
  leggiTasti(FINE);
  DOWN_FINTO = -1;
  if (quale() != PRONTA) {
    fprintf(stderr, "KO il tasto non chiude il racconto della fine\n"); exit(1);
  }
  /* E NON MANDA NIENTE AL SLICER. Il racconto e' roba del vetro: una
     parola che partisse di qui arriverebbe a un programma che non sa che
     cosa farsene, e il protocollo e' quello che tiene insieme i due. */
  if (daMandare[0]) {
    fprintf(stderr, "KO chiudendo il racconto ha mandato «%s» al SLICER\n",
            daMandare); exit(1);
  }

  /* LO STESSO SULLA FERMATA, che e' l'altra meta' della richiesta: una
     stampa annullata e' proprio quella che non vuoi vederti davanti per
     tre minuti. */
  raccontoChiuso = false;
  strcpy(S.stato, "fermata"); raccontaDa = OROLOGIO;
  if (quale() != FERMATA) { fprintf(stderr, "KO la fermata non si vede\n"); exit(1); }
  DOWN_FINTO = (int)padDi(ALTO_SX);
  leggiTasti(FERMATA);
  DOWN_FINTO = -1;
  if (quale() != PRONTA) {
    fprintf(stderr, "KO il tasto non chiude il racconto della fermata\n"); exit(1);
  }

  /* E LA STAMPA DOPO SI VEDE LO STESSO. E' la trappola di una variabile
     che si accende e non si spegne: chiuso il racconto una volta, senza
     il ritorno a `false` al cambio di stato la fine della stampa
     successiva non comparirebbe MAI piu' — e il telecomando smetterebbe
     di dire l'unica cosa per cui lo guardi da lontano. */
  /* Si passa dal vero parsing del messaggio, `leggiMessaggio`, e non si
     scrive `S.stato` a mano: il ritorno a `false` sta proprio nel giro che
     si accorge del cambio di stato, e scrivendo la variabile da fuori
     quel giro non succederebbe — la prova direbbe «va bene» guardando un
     codice che non e' stato eseguito. */
  leggiMessaggio("{\"stato\":\"invio\",\"percento\":10}");
  leggiMessaggio("{\"stato\":\"fine\"}");
  ultimoMessaggio = OROLOGIO;
  if (quale() != FINE) {
    fprintf(stderr, "KO chiuso una volta, la fine non si vede mai piu'\n"); exit(1);
  }
  raccontoChiuso = false; raccontaDa = 0;

  /* I TRE PASSI DEL CAMBIO PENNA. Dal 2026-11-03 sono tre e non due: dopo
     aver montato la penna nuova si va a ritrovarne la PUNTA, che non sta
     dove stava quella di prima. Senza il terzo caso qui sotto il vetro
     direbbe ancora «MONTA» mentre il SLICER chiede l'angolo del foglio:
     una schermata che dice una cosa e una macchina che ne aspetta un'altra,
     che e' il difetto che questo banco esiste per trovare. */
  fermandoDa = 0; raccontaDa = 0;
  strcpy(S.stato, "cambio");
  S.passo = 0;
  if (quale() != PENNA1) { fprintf(stderr, "KO passo 0 non e' PENNA1\n"); exit(1); }
  S.passo = 1;
  if (quale() != PENNA2) { fprintf(stderr, "KO passo 1 non e' PENNA2\n"); exit(1); }
  S.passo = 2;
  if (quale() != PENNA3) {
    fprintf(stderr, "KO al terzo passo il vetro dice ancora «monta la penna»\n");
    exit(1);
  }
  /* E su quella schermata non c'e' niente da premere: ritrovare la punta
     vuol dire guidare la testina e guardare dove cade, e un tasto «fatto»
     premibile senza aver mosso niente sposterebbe il programma di venti
     millimetri per sbaglio. */
  {
    Tasto t[4];
    if (tastiDi(PENNA3, t) != 0) {
      fprintf(stderr, "KO il terzo passo offre un tasto che non deve esserci\n");
      exit(1);
    }
  }
  S.passo = -1;

  OROLOGIO = 0;
  strcpy(S.stato, "invio"); S.percento = 67;

  /* LA CADENZA LA DECIDE LO STATO, e si prova per la strada vera: un
     messaggio del SLICER. Il problema chiama ogni dieci secondi e scade;
     il cambio penna ogni venti e NON scade. Sbagliare qui vorrebbe dire
     due allarmi con la stessa cadenza, cioe' indistinguibili attutiti -
     che e' esattamente il rischio per cui la sirena e' stata accettata. */
  OROLOGIO = 50000;
  /* ============ IL MESSAGGIO PORTA IL FOGLIO ============
     `foglio` e' un oggetto come `penna`. Assente o null vuol dire «non lo
     dice», e allora i due numeri si AZZERANO: un numero rimasto da prima
     sarebbe peggio di nessun numero -- direbbe «foglio 3 di 9» mentre si
     stampa su un foglio solo. */
  leggiMessaggio("{\"stato\":\"invio\",\"foglio\":{\"n\":5,\"di\":9}}");
  if (S.foglioN != 5 || S.foglioDi != 9) {
    fprintf(stderr, "KO il foglio non si legge dal messaggio (%d/%d)\n",
            S.foglioN, S.foglioDi); exit(1);
  }
  leggiMessaggio("{\"stato\":\"invio\",\"foglio\":null}");
  if (S.foglioN != 0 || S.foglioDi != 0) {
    fprintf(stderr, "KO un foglio null non azzera quello di prima (%d/%d)\n",
            S.foglioN, S.foglioDi); exit(1);
  }
  leggiMessaggio("{\"stato\":\"invio\",\"foglio\":{\"n\":2,\"di\":3}}");
  leggiMessaggio("{\"stato\":\"invio\"}");
  if (S.foglioN != 0 || S.foglioDi != 0) {
    fprintf(stderr, "KO un messaggio senza foglio non azzera quello di prima\n");
    exit(1);
  }

  leggiMessaggio("{\"stato\":\"fermo\"}");        /* il primo non suona */
  leggiMessaggio("{\"stato\":\"errore\"}");
  if (richiamoOgni != RICHIAMO_ERRORE || richiamoFino == 0) {
    fprintf(stderr, "KO il problema non chiama ogni dieci secondi, o non scade\n"); exit(1);
  }
  leggiMessaggio("{\"stato\":\"cambio\"}");
  if (richiamoOgni != RICHIAMO_PENNA || richiamoFino != 0) {
    fprintf(stderr, "KO il cambio penna non chiama ogni venti secondi, o scade\n"); exit(1);
  }
  leggiMessaggio("{\"stato\":\"invio\"}");
  if (richiamo) {
    fprintf(stderr, "KO il richiamo non si e' spento cambiando stato\n"); exit(1);
  }
  inSuono = nullptr;

  /* IL RICHIAMO. Tre cose, e tutte e tre sono modi in cui un allarme
     diventa inutile o insopportabile: una sirena che non parte, una che
     non si puo' zittire, e una che non smette mai. */
  OROLOGIO = 100000;
  strcpy(S.stato, "errore");
  inSuono = nullptr;
  ARMA(SUONO_ERRORE, RICHIAMO_ERRORE, ALLARME_PER);

  OROLOGIO += 9000; richiama();
  if (inSuono) { fprintf(stderr, "KO ha richiamato dopo nove secondi\n"); exit(1); }
  OROLOGIO += 2000; richiama();
  if (!inSuono) { fprintf(stderr, "KO non ha richiamato dopo undici secondi\n"); exit(1); }

  /* Un pad qualunque zittisce, anche se sulla schermata del problema non
     c'e' nessun tasto vivo: il pad 3 non e' un tasto, e deve bastare. */
  inSuono = nullptr; TOCCO_FINTO = 3;
  leggiTasti(ERRORE);
  TOCCO_FINTO = -1;
  if (richiamo) { fprintf(stderr, "KO il pad non ha zittito la sirena\n"); exit(1); }

  /* E a tre minuti smette da se'. */
  ARMA(SUONO_ERRORE, RICHIAMO_ERRORE, ALLARME_PER);
  OROLOGIO += ALLARME_PER + 11000; inSuono = nullptr; richiama();
  if (richiamo || inSuono) { fprintf(stderr, "KO la sirena non si e' fermata a tre minuti\n"); exit(1); }

  /* Il cambio penna invece NON scade: la' la macchina sta aspettando. */
  strcpy(S.stato, "cambio");
  ARMA(SUONO_PENNA, RICHIAMO_PENNA, 0);
  OROLOGIO += 3600000; inSuono = nullptr; richiama();
  if (!inSuono) { fprintf(stderr, "KO il cambio penna ha smesso di chiamare\n"); exit(1); }
  fermaRichiamo(); inSuono = nullptr; OROLOGIO = 0;
  strcpy(S.stato, "invio"); S.percento = 67; S.rimanente = 190000; S.passo = 1;
  strcpy(S.penna, "#c8102e"); strcpy(S.nome, "biglietto.svg");
  strcpy(S.macchina, "Run"); S.azzerata = true; S.giu = 1;

  /* Lo stop che si tiene premuto: la cornice e lo spicchio a tre quarti,
     disegnato a fette come fa il firmware venti volte al secondo. */
  disegnaTutto(STOP_TIENI);
  tenutaDisegnata = -1; tenutoDa = 0; armato = true; tenendo = true;
  for (int i = 0; i <= 15; i++) { OROLOGIO = i * TENUTA_MS / 20; aggiornaPezzi(STOP_TIENI); }
  salva("tieni");

  /* Il conto alla rovescia dell'anello: si svuota, e quello che se ne va
     si spegne a pezzi. Qui a meta'. */
  disegnaTutto(STOP_ARMATO);
  armatoDa = 0;
  /* A PASSI MINUSCOLI, piu' fitti di quanto il firmware ne faccia davvero:
     serve a provare che sotto il passo minimo l'anello non si muove MA non
     perde nemmeno un pezzo per strada - le differenze si sommano finche'
     non valgono un pixel. Con un passo sbagliato qui restano buchi. */
  for (int i = 0; i <= 400; i++) { OROLOGIO = i * ARMATO_MS / 800; aggiornaPezzi(STOP_ARMATO); }
  salva("armato-meta");

  /* La stampa che avanza: l'anello cresce a pezzi, e il numero si
     riscrive sopra a quello di prima. */
  strcpy(S.stato, "invio");
  S.percento = 8; disegnaTutto(STAMPA);
  for (int p = 9; p <= 94; p++) { S.percento = p; S.rimanente = (100 - p) * 9000L; aggiornaPezzi(STAMPA); }
  salva("stampa-94");
  return 0;
}
