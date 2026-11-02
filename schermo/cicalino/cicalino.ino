/* ===================================================================
 * IL CICALINO, TARATO A ORECCHIO
 *
 * Sketch di servizio: si carica una volta, si trova la frequenza, si
 * rimette il telecomando. Non fa parte del firmware.
 *
 * PERCHÉ SERVE. Il cicalino M1 del carrier è un ABT-461-RC, un
 * trasduttore magnetico a comando esterno: non ha l'oscillatore dentro e
 * NON HA VOLUME — o commuta o non commuta. L'unica cosa che cambia
 * quanto si sente è la frequenza, perché ha una risonanza. Il firmware
 * usa 4000 Hz, che è un numero MESSO A CASO in attesa di questa prova;
 * il foglio tecnico del venditore dà 2731 Hz di risonanza e misura gli
 * 85 dB a 3000 Hz, quindi 4000 è probabilmente mezza ottava di troppo.
 * Ma un foglio tecnico parla del pezzo nudo: qui il pezzo sta dentro a
 * una scatola di plastica con un foro, e la scatola ha la sua idea.
 *
 * PERCHÉ A ORECCHIO, E PERCHÉ NON È UN RIPIEGO. Con un fonometro si
 * troverebbe il massimo di pressione acustica. Ma non serve quello:
 * serve la frequenza che un umano, in laboratorio, sente di più — e
 * l'orecchio ha la sua curva di sensibilità, che è massima proprio fra i
 * 3 e i 4 kHz. Misurare col fonometro e poi scegliere a orecchio darebbe
 * due numeri diversi, e quello buono è il secondo: non si sta misurando
 * il cicalino, si sta accordando la COPPIA cicalino + orecchio.
 *
 * PERCHÉ A DUE PER VOLTA E NON IN FILA. Quindici note una dietro
 * l'altra non si classificano: a metà spazzata non si ricorda più quanto
 * era forte la terza. Due note che si alternano, invece, si confrontano
 * senza memoria — e basta dire quale delle due. Quindi: torneo a
 * eliminazione, quattordici confronti, il vincitore resta in campo.
 *
 * E I NUMERI NON SI VEDONO durante il confronto. Sapere che una delle
 * due è «quella del foglio tecnico» basta a sentirla più forte: le due
 * note si chiamano A e B, e il lato del campione si scambia a ogni
 * confronto, così non si finisce a premere sempre lo stesso pad. I Hz
 * si scoprono alla fine.
 *
 * COME SI USA
 *   1. Si carica questo sketch.
 *   2. Partono due note che si alternano. Pad in ALTO A SINISTRA se si
 *      sente più forte A, in ALTO A DESTRA se B, in BASSO AL CENTRO se
 *      sono pari (resta chi c'era).
 *   3. Quattordici confronti sulla griglia larga, poi quattro di
 *      rifinitura intorno al vincitore. Se nella rifinitura non si
 *      sente differenza, NON È UN FALLIMENTO: vuol dire che si è sul
 *      pianoro della risonanza, e il numero grosso era già giusto.
 *   4. Alla fine la frequenza compare sul vetro e sul seriale. Si copia
 *      in `RISONANZA` dentro a `telecomando.ino`.
 *
 * E L'ULTIMO CONFRONTO SI RIFÀ CON LA MACCHINA CHE SI MUOVE. Il cicalino
 * serve a farsi sentire SOPRA i motori, non in una stanza silenziosa, e
 * un rumore di fondo non maschera tutte le frequenze allo stesso modo.
 * Il pad centrale, tenuto premuto a torneo finito, rimette in campo il
 * vincitore contro il secondo: quello va fatto col plotter che disegna.
 * =================================================================== */
#include <Arduino_MKRIoTCarrier.h>
MKRIoTCarrier carrier;

#define COL(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
const uint16_t NERO  = 0x0000;
const uint16_t TESTO = COL(0xE6, 0xEA, 0xF0);
const uint16_t FIOCO = COL(0x6B, 0x76, 0x86);
const uint16_t VERDE = COL(0x43, 0xB5, 0x81);
const uint16_t AMBRA = COL(0xE0, 0xA6, 0x3A);

const int CX = 120;

/* LA GRIGLIA, A SESTI DI OTTAVA da 1 a 5 kHz. I passi sono del 12% e non
   fissi in Hz perché l'orecchio e le risonanze lavorano in rapporti, non
   in differenze: 100 Hz in più contano molto a 1 kHz e niente a 5. Sotto
   1 kHz un trasduttore di questa taglia non ha niente da dire, e sopra 5
   si entra dove l'orecchio ricomincia a perdere. */
const int GRIGLIA[] = { 1000, 1120, 1260, 1410, 1580, 1780, 2000, 2240,
                        2500, 2800, 3150, 3550, 4000, 4500, 5000 };
const int QUANTI = sizeof(GRIGLIA) / sizeof(GRIGLIA[0]);

/* La rifinitura: ±6% intorno al vincitore, a passi del 3%. Più fitto di
   così non si sente, e la griglia larga lascia aperto al massimo un ±6%. */
const float RIFINITURA[] = { 0.94, 0.97, 1.03, 1.06 };
const int QUANTE_RIF = sizeof(RIFINITURA) / sizeof(RIFINITURA[0]);

int campione = 0, sfidante = 0, secondo = 0;
int prossimo = 0, duello = 0, duelliTotali = 0;
int fase = 1;                  // 1 griglia, 2 rifinitura, 3 finito
bool campioneAsinistra = true;
int rifinituraDa = 0;

int pezzo = 0;                 // 0 suona A, 1 zitto, 2 suona B, 3 zitto
unsigned long battuta = 0;
const unsigned long CANTA = 600, ZITTO = 150;

void disegnaLettere();          // la usa `disegnaDuello`, che viene prima

int hzA() { return campioneAsinistra ? campione : sfidante; }
int hzB() { return campioneAsinistra ? sfidante : campione; }

void scritta(const char* s, int y, int k, uint16_t c) {
  carrier.display.setTextSize(k);
  carrier.display.setTextColor(c);
  carrier.display.setCursor(CX - ((int)strlen(s) * 6 * k - k) / 2, y);
  carrier.display.print(s);
}

void disegnaDuello() {
  carrier.display.fillScreen(NERO);
  scritta("QUALE SI SENTE DI PIU'", 28, 1, FIOCO);
  char riga[32];
  snprintf(riga, sizeof(riga), "%d di %d", duello, duelliTotali);
  scritta(riga, 44, 1, FIOCO);
  scritta(fase == 1 ? "griglia larga" : "rifinitura", 196, 1, FIOCO);
  scritta("pari: pad in basso", 212, 1, FIOCO);
  disegnaLettere();
}

void disegnaLettere() {
  bool a = (pezzo == 0), b = (pezzo == 2);
  carrier.display.setTextSize(7);
  carrier.display.setTextColor(a ? VERDE : FIOCO);
  carrier.display.setCursor(48, 100);  carrier.display.print("A");
  carrier.display.setTextColor(b ? VERDE : FIOCO);
  carrier.display.setCursor(150, 100); carrier.display.print("B");
  /* I pad stanno dove stanno le lettere, e si dice quale: senza questo,
     «sinistra» vuol dire la sinistra di chi? */
  scritta("in alto sx        in alto dx", 170, 1, FIOCO);
}

void mostraVincitore() {
  carrier.display.fillScreen(NERO);
  scritta("RISONANZA", 54, 2, AMBRA);
  char riga[16];
  snprintf(riga, sizeof(riga), "%d", campione);
  scritta(riga, 96, 5, TESTO);
  scritta("Hz", 150, 2, FIOCO);
  scritta("pad in basso: rifai", 196, 1, FIOCO);
  scritta("l'ultimo, coi motori", 208, 1, FIOCO);
  Serial.println();
  Serial.print("RISONANZA = "); Serial.print(campione);
  Serial.println("  <- copia questo in telecomando.ino");
  Serial.print("secondo arrivato: "); Serial.println(secondo);
}

/* Prepara il duello dopo: torna false quando sono finiti. */
bool prossimoDuello() {
  if (fase == 1) {
    if (prossimo < QUANTI) {
      sfidante = GRIGLIA[prossimo++];
      duello++;
      campioneAsinistra = !campioneAsinistra;
      return true;
    }
    /* La griglia è finita: si entra in rifinitura intorno al vincitore. */
    fase = 2;
    rifinituraDa = 0;
    duelliTotali = duello + QUANTE_RIF;
  }
  if (fase == 2 && rifinituraDa < QUANTE_RIF) {
    sfidante = (int)(campione * RIFINITURA[rifinituraDa++] + 0.5);
    duello++;
    campioneAsinistra = !campioneAsinistra;
    return true;
  }
  fase = 3;
  return false;
}

void vince(int hz) {
  int perso = (hz == campione) ? sfidante : campione;
  Serial.print("duello "); Serial.print(duello);
  Serial.print(": "); Serial.print(hz);
  Serial.print(" batte "); Serial.println(perso);
  /* Il secondo è sempre l'ultimo che il campione ha battuto: serve solo
     per la rivincita finale coi motori accesi, non per una classifica. */
  campione = hz;
  secondo = perso;
  carrier.Buzzer.noSound();
  if (prossimoDuello()) { pezzo = 0; battuta = 0; disegnaDuello(); }
  else                  mostraVincitore();
}

void setup() {
  Serial.begin(9600);
  carrier.noCase();
  carrier.begin();
  pinMode(TFT_BACKLIGHT, OUTPUT);
  digitalWrite(TFT_BACKLIGHT, HIGH);
  carrier.display.setRotation(2);

  campione = GRIGLIA[0];
  prossimo = 1;
  duelliTotali = QUANTI - 1 + QUANTE_RIF;
  prossimoDuello();
  disegnaDuello();
  Serial.println("Torneo del cicalino: A = pad alto sinistra, B = alto destra, pari = basso.");
}

void loop() {
  carrier.Buttons.update();

  if (fase == 3) {
    /* Finito: il vincitore canta a intermittenza, e il pad centrale
       rimette in campo il secondo — da fare coi motori che girano. */
    unsigned long t = millis() % 1200;
    if (t < 400) carrier.Buzzer.sound(campione);
    else         carrier.Buzzer.noSound();
    if (carrier.Buttons.onTouchDown(TOUCH2) && secondo) {
      fase = 2; rifinituraDa = QUANTE_RIF;   // nessun altro sfidante dopo
      sfidante = secondo; duello++; duelliTotali = duello;
      campioneAsinistra = !campioneAsinistra;
      pezzo = 0; battuta = 0; disegnaDuello();
    }
    return;
  }

  /* Le due note si alternano da sole: niente `delay()`, così il pad
     risponde nell'istante in cui lo sfiori e non alla fine della nota. */
  unsigned long ora = millis();
  unsigned long quanto = (pezzo == 0 || pezzo == 2) ? CANTA : ZITTO;
  if (battuta == 0 || ora - battuta >= quanto) {
    battuta = ora;
    pezzo = (pezzo + 1) & 3;
    if (pezzo == 0)      carrier.Buzzer.sound(hzA());
    else if (pezzo == 2) carrier.Buzzer.sound(hzB());
    else                 carrier.Buzzer.noSound();
    disegnaLettere();
  }

  if (carrier.Buttons.onTouchDown(TOUCH4)) vince(hzA());
  else if (carrier.Buttons.onTouchDown(TOUCH0)) vince(hzB());
  else if (carrier.Buttons.onTouchDown(TOUCH2)) vince(campione);
}
