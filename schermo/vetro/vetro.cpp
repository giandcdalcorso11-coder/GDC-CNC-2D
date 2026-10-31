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
bool Qtouch::getTouch(touchButtons) { return false; }
bool Qtouch::onTouchDown(touchButtons) { return false; }
bool Qtouch::onTouchUp(touchButtons) { return false; }
void Buz::sound(int) {} void Buz::noSound() {} void Buz::beep(int, unsigned long) {}
int MKRIoTCarrier::begin() { return 1; }
void MKRIoTCarrier::noCase() {} void MKRIoTCarrier::withCase() {}

unsigned long millis() { return OROLOGIO; }
void delay(unsigned long) {}
void pinMode(int, int) {} void digitalWrite(int, int) {} int digitalRead(int) { return 0; }
void analogWrite(int, int) {} int analogRead(int) { return 512; }
void tone(int, int) {} void noTone(int) {}
void SerialeFinta::begin(long) {}
void SerialeFinta::print(const char*) {} void SerialeFinta::print(int) {}
void SerialeFinta::print(long) {} void SerialeFinta::print(float) {} void SerialeFinta::print(char) {}
void SerialeFinta::println(const char*) {} void SerialeFinta::println(int) {}
void SerialeFinta::println(long) {} void SerialeFinta::println(float) {} void SerialeFinta::println() {}
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

static void schermata(Schermata s, const char* nome) {
  disegnaTutto(s);
  salva(nome);
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
  schermata(IN_PAUSA, "pausa");
  schermata(PENNA1, "penna1");
  schermata(PENNA2, "penna2");
  schermata(STOP_ARMATO, "armato");
  schermata(FINE, "fine");
  schermata(ERRORE, "errore");
  schermata(ATTESA, "attesa");

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
