// CNC-2D — Dashboard web ESP32 (banco di collaudo: LED, Wi-Fi via web, OTA, log, assi X/Y, servo)
//
// Librerie usate: tutte incluse nel core ESP32 per Arduino (nessuna installazione extra):
// WiFi.h, WebServer.h, Preferences.h, ArduinoOTA.h
//
// Comportamento al boot:
// - Se sono salvate credenziali Wi-Fi valide, si connette alla rete di casa (modalità STA)
//   ed è raggiungibile su http://cnc2d.local oppure sull'IP mostrato sul Serial Monitor.
// - Se non ci sono credenziali salvate, o la connessione fallisce, apre un Access Point
//   di emergenza (SSID/PASS sotto) su cui è comunque raggiungibile la stessa pagina,
//   per poter impostare/correggere le credenziali dalla tab Wi-Fi.
//
// Una volta connesso alla rete di casa, i successivi aggiornamenti firmware possono
// essere caricati via Wi-Fi (OTA) da Arduino IDE selezionando la porta di rete "cnc2d",
// senza bisogno del cavo USB. Password OTA: la stessa dell'Access Point di emergenza.
//
// DUE CAMBIAMENTI STRUTTURALI RISPETTO ALLE VERSIONI PRECEDENTI:
//
// 1. I passi non sono più generati dentro loop(). Con i microstep attivi la frequenza
//    sale a qualche migliaio di impulsi al secondo, e server.handleClient() può bloccare
//    il loop per centinaia di millisecondi: ogni blocco diventava un buco nel treno di
//    impulsi, cioè passi persi. Ora gli impulsi li emette un timer hardware a 20 kHz,
//    che il web non può interrompere.
//
// 2. L'interfaccia parla in millimetri, non in passi. Il legame fra i due lo danno
//    pignone e cremagliera: un giro di pignone (modulo 1,5, 20 denti) vale
//    pi * m * z = 94,2478 mm. Con microstep 1/16 fanno 33,953 passi/mm. Il numero di
//    microstep è impostabile dalla tab Motore perché dipende dai ponticelli MS1/MS2/MS3
//    sul driver, ed è l'unica cosa che il firmware non può leggere da solo.

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <math.h>
#include "soc/gpio_struct.h" // scrittura diretta sui registri GPIO dentro l'interruzione

#define RED_LED_PIN 2
#define YELLOW_LED_PIN 19
#define GREEN_LED_PIN 18

// Nomi degli assi secondo la convenzione cartesiana del foglio:
//   X = la trave del portale (staffa LL), il carrello che porta la penna.
//       Sul foglio e' il movimento DA SINISTRA A DESTRA.  Driver su GPIO 4/26.
//   Y = le due rotaie di base (staffe TT), su cui scorre tutto il portale.
//       Sul foglio e' il movimento DAL BASSO VERSO L'ALTO.  Driver su GPIO 25/33.
//
// CORREZIONE DEL 2026-10-19. Il 15 ottobre questi quattro numeri sono stati
// scambiati per allineare i nomi alla convenzione cartesiana, ma lo scambio era
// sbagliato: i nomi erano da sistemare, l'abbinamento ai pin no. Il driver su
// 4/26 e' sempre stato quello del carrello sulla trave, non quello del portale
// — l'avevo descritto al contrario e poi ho "corretto" i pin per farli
// combaciare con la descrizione sbagliata.
//
// Sintomo: la pulsantiera manda le frecce destra/sinistra sull'asse x e
// su/giu' sull'asse y, che e' giusto; ma con i pin scambiati le frecce
// destra/sinistra muovevano la testina in alto e in basso.
//
// Verifica se un giorno ci fossero di nuovo dubbi: premi la freccia destra.
// Si deve muovere IL CARRELLO LUNGO LA TRAVE, non tutto il portale.
#define STEP_X_PIN 4
#define DIR_X_PIN 26
#define STEP_Y_PIN 25
#define DIR_Y_PIN 33
#define ENABLE_PIN 27 // condiviso tra i due driver
#define SERVO_PIN 32

// Se i tre ponticelli MS1/MS2/MS3 sono stati messi in parallelo e portati a un GPIO
// dell'ESP32 invece che fissi a 5 V, metti qui quel GPIO: il firmware lo porta alto
// per 1/16 e basso per il passo intero. Lasciando -1 non viene pilotato nessun pin
// e il valore impostato dalla pagina serve solo ai conti (caso dei ponticelli fissi).
#define MS_PIN -1

// Servo standard: 50 Hz, impulso 500-2500 us per 0-180 gradi.
#define SERVO_FREQ 50
#define SERVO_RES_BITS 16
#define SERVO_CHANNEL 4
const int SERVO_US_MIN = 500;
const int SERVO_US_MAX = 2500;

#define WIFI_CONNECT_TIMEOUT_MS 15000

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------
// Stanno qui, prima di qualunque funzione, e non vicino al codice che li usa:
// l'IDE Arduino genera da solo i prototipi di tutte le funzioni dello sketch e
// li inserisce subito prima della PRIMA funzione del file. Un tipo definito più
// in basso non esisterebbe ancora quando il prototipo generato lo nomina, e il
// compilatore si ferma su "'Motor' was not declared in this scope" indicando la
// riga della definizione, che a leggerla sembra corretta.

// stepsRemaining: 0 = fermo, >0 = passi ancora da fare, -1 = rotazione continua.
// acc/inc sono l'accumulatore a virgola fissa descritto sopra; li tocca l'ISR,
// quindi ogni modifica dal lato web passa dalla sezione critica.
struct Motor {
  const char* name;
  uint8_t stepPin;
  uint8_t dirPin;
  volatile long stepsRemaining;
  volatile long stepsDone;
  volatile uint32_t acc;
  volatile uint32_t inc;
  volatile uint32_t incTarget;
  volatile long rampSteps;
  volatile bool pulseOpen;
  int dir;
  float feedMmS;  // velocità impostata dall'utente
  float rampMm;   // su quanti mm si distribuisce la partenza
  bool invert;    // inverte il verso di DIR, per allineare l'asse alle frecce senza rifare i cavi

  // Taratura e posizione, aggiunti il 2026-10-19 per le misure degli assi.
  //
  // mmPerRev e' la circonferenza primitiva REALE di questo pignone, non quella
  // nominale: le due cremagliere sono state stampate separatamente e si sono
  // ritirate di quantita' diverse, quindi i due assi hanno due numeri diversi.
  // E' salvato in NVS e si ricava misurando col calibro (vedi handleMotorCalib).
  //
  // posSteps e' la posizione assoluta in passi dall'ultimo azzeramento, con il
  // segno della direzione LOGICA (quella delle frecce), non del livello del pin
  // DIR: cosi' premendo la freccia destra il numero sale anche con invert attivo.
  // La tiene in passi e non in millimetri di proposito, perche' un accumulatore
  // in float perderebbe risoluzione dopo qualche migliaio di passi.
  float mmPerRev;
  volatile long posSteps;
  volatile int dirSign;  // +1 o -1, lo legge l'ISR per contare nel verso giusto

  // posNota dice se posSteps vuol dire qualcosa. Parte a false all'accensione —
  // appena acceso nessuno sa dove sono i carrelli — e torna false ogni volta che
  // i driver vengono liberati, perche' da li' in poi l'asse si puo' spostare a
  // mano e nessun impulso lo racconta. Torna true solo con un azzeramento.
  //
  // Serve perche' uno stepper e' ad anello aperto: non c'e' niente che misuri la
  // posizione, il contatore conta gli impulsi MANDATI. Senza questo flag, dopo
  // uno spostamento a mano il DRO mostrerebbe con tre decimali una posizione che
  // non esiste piu'. Un numero sbagliato e' peggio di nessun numero.
  bool posNota;
};

// op: 0 = fine, 1 = rapido, 2 = tratto di lavoro, 3 = penna su, 4 = penna giù, 5 = pausa
struct DemoStep {
  uint8_t op;
  float x;
  float y;
};


// ---------------------------------------------------------------------------
// Meccanica: pignone e cremagliera
// ---------------------------------------------------------------------------
// Un giro di pignone avanza di un passo del dente per ogni dente, cioè pi*m*z.
// Non dipende dal numero di denti del pignone solo come numero: cambiandolo
// cambia sia la corsa per giro sia la risoluzione, quindi è qui e non sparso.
const float GEAR_MODULE_MM = 1.5f;
const int GEAR_TEETH = 20;
const float MM_PER_REV = 3.14159265f * GEAR_MODULE_MM * GEAR_TEETH; // 94,2478 mm NOMINALI
const int FULL_STEPS_PER_REV = 200;                                 // motore 1,8 gradi

// Estremi accettati per la taratura: il nominale e' 94,2478, e un valore fuori
// da questa forchetta e' un errore di battitura, non un ritiro di stampa.
const float MM_PER_REV_MIN = 60.0f;
const float MM_PER_REV_MAX = 130.0f;

// Microstep impostati sul driver con i ponticelli. Salvato in NVS.
int microsteps = 16;

// Passi/mm di UN asse, non della macchina: ogni asse ha il suo mmPerRev tarato.
// Il valore globale che stava qui prima e' stato tolto il 2026-10-19 — con una
// cremagliera per asse, stampate separatamente, un numero solo fa uscire i
// quadrati rettangoli.
float stepsPerMm(const Motor& m) {
  return (float)FULL_STEPS_PER_REV * (float)microsteps / m.mmPerRev;
}

long stepsPerRev() {
  return (long)FULL_STEPS_PER_REV * (long)microsteps;
}

// ---------------------------------------------------------------------------
// Generazione passi: timer hardware
// ---------------------------------------------------------------------------
// Il timer scatta a TICK_HZ e, a ogni scatto, ogni asse somma il proprio
// incremento a un accumulatore a virgola fissa: quando l'accumulatore supera
// 65536 esce un impulso. Così la frequenza media è esatta anche quando non è
// un sottomultiplo del tick, invece di essere arrotondata al tick più vicino.
#define TICK_HZ 20000
#define ACC_ONE 65536UL

const unsigned long DIR_SETUP_US = 20;
const unsigned long STEP_PULSE_US = 10; // solo per l'impulso singolo emesso fuori dall'ISR

// Limiti dell'interfaccia, in millimetri al secondo.
const float FEED_MIN_MM_S = 1.0f;
const float FEED_MAX_MM_S = 100.0f;
const float RAMP_MIN_MM = 0.0f;
const float RAMP_MAX_MM = 20.0f;
const long STEPS_PER_SEC_MAX = 6000; // tetto di sicurezza a valle di qualunque conto

const char* AP_SSID = "CNC-2D-Setup";
const char* AP_PASS = "cnc2d2026";

Preferences prefs;
Preferences motorPrefs;
WebServer server(80);

bool ledRedState = false;
bool ledYellowState = false;
bool ledGreenState = false;
bool apMode = false;
volatile bool driverEnabled = true;

// Stato penna: "up", "down", "free" (nessun impulso, servo morbido) o "man" (angolo
// impostato a mano dallo slider). All'accensione si parte da "free": un servo che va
// in battuta contro un vincolo meccanico appena dato corrente assorbe moltissimo.
int penUpDeg = 90;
int penDownDeg = 60;

// Verso del servo. Sul modulo montato il 2026-10-21 l'accoppiamento esce
// INVERTITO: facendo crescere l'angolo fisico la penna SCENDE. Invece di
// convivere con due convenzioni opposte — il meccanismo in un verso e tutto il
// resto del progetto nell'altro — si converte in un posto solo, qui.
//
// Da qui in avanti i gradi che si vedono nella pagina, che si salvano in NVS e
// che finiscono nel profilo del SLICER sono gradi LOGICI: piu gradi = penna
// piu in alto, sempre. La conversione in angolo fisico la fa servoApply() e
// non la fa nessun altro.
//
// Resta cosi valida ovunque la regola del progetto:
//     battuta < penna abbassata < penna alzata
bool penInvert = true;
int penAngle = 90;
String penState = "free";

// Rampa del servo. Un servo a cui si chiede un angolo lontano vede un errore
// grande e parte alla corrente di stallo: e' quello che faceva cadere il 5 V e
// resettare l'ESP32. Avvicinandosi di pochi gradi per volta l'errore resta
// piccolo e la corrente di picco con lui. servoSlewDeg = 0 disattiva la rampa
// e torna al salto secco.
// Limite noto: ripartendo da "rilasciato" la posizione reale della squadretta
// non la sa nessuno, quindi la rampa parte dall'ultimo angolo comandato. Se nel
// frattempo la squadretta e' stata mossa a mano, quel primo movimento e' secco
// comunque: non c'e' retroazione da cui leggere dove si trova davvero.
int servoSlewDeg = 2;                  // gradi per passo, salvato in NVS
const unsigned long SERVO_SLEW_MS = 10; // intervallo fra un passo e il successivo
int servoTargetDeg = 90;
int servoCurrentDeg = 90;
bool servoAttached = false;             // false = nessun impulso, servo morbido
unsigned long servoLastStepMs = 0;

Motor motorX = {"X", STEP_X_PIN, DIR_X_PIN, 0, 0, 0, 0, 0, 0, false, 1, 20.0f, 3.0f, false,
                MM_PER_REV, 0, 1, false};
Motor motorY = {"Y", STEP_Y_PIN, DIR_Y_PIN, 0, 0, 0, 0, 0, 0, false, 1, 20.0f, 3.0f, false,
                MM_PER_REV, 0, 1, false};

portMUX_TYPE stepMux = portMUX_INITIALIZER_UNLOCKED;
hw_timer_t* stepTimer = NULL;

String logBuffer = "";
const size_t LOG_MAX_LEN = 4000;

void logMsg(const String& msg) {
  Serial.println(msg);
  logBuffer += msg;
  logBuffer += "\n";
  if (logBuffer.length() > LOG_MAX_LEN) {
    logBuffer = logBuffer.substring(logBuffer.length() - LOG_MAX_LEN);
  }
}

// Scrittura diretta sul registro GPIO: dentro un'interruzione digitalWrite()
// non è garantita in IRAM e costa troppo.
static inline void IRAM_ATTR pinFastHigh(uint8_t p) {
  if (p < 32) GPIO.out_w1ts = (1UL << p);
  else GPIO.out1_w1ts.val = (1UL << (p - 32));
}

static inline void IRAM_ATTR pinFastLow(uint8_t p) {
  if (p < 32) GPIO.out_w1tc = (1UL << p);
  else GPIO.out1_w1tc.val = (1UL << (p - 32));
}

// Durante la rampa il primo passo parte 4 volte più lento della velocità
// impostata e si accelera linearmente fino ad essa.
static inline void IRAM_ATTR applyRamp(Motor& m) {
  if (m.rampSteps > 0 && m.stepsDone < m.rampSteps) {
    uint32_t den = (uint32_t)(m.rampSteps + 3 * (m.rampSteps - m.stepsDone));
    uint32_t v = (uint32_t)(((uint64_t)m.incTarget * (uint64_t)m.rampSteps) / den);
    m.inc = (v == 0) ? 1 : v;
  } else {
    m.inc = m.incTarget;
  }
}

void IRAM_ATTR serviceMotorISR(Motor& m) {
  // L'impulso aperto al tick precedente va chiuso sempre, anche se nel frattempo
  // il movimento è stato fermato: un pin STEP lasciato alto fa perdere l'impulso dopo.
  if (m.pulseOpen) {
    pinFastLow(m.stepPin);
    m.pulseOpen = false;
  }
  if (m.stepsRemaining == 0 || !driverEnabled) return;

  m.acc += m.inc;
  if (m.acc < ACC_ONE) return;
  m.acc -= ACC_ONE;

  pinFastHigh(m.stepPin);
  m.pulseOpen = true;
  m.stepsDone++;
  m.posSteps += m.dirSign;
  if (m.stepsRemaining > 0) m.stepsRemaining--;
  applyRamp(m);
}

void IRAM_ATTR onStepTick() {
  serviceMotorISR(motorX);
  serviceMotorISR(motorY);
}

void setDriverEnabled(bool on) {
  driverEnabled = on;
  digitalWrite(ENABLE_PIN, on ? LOW : HIGH); // A4988: ENABLE attivo basso
}

// DIR va impostato una sola volta a inizio movimento, non ad ogni passo:
// l'A4988 richiede che sia stabile prima del fronte di salita di STEP.
void setDir(Motor& m, int dir) {
  m.dir = dir;
  bool high = (dir > 0) != m.invert;
  digitalWrite(m.dirPin, high ? HIGH : LOW);
  delayMicroseconds(DIR_SETUP_US);
}

// Scrive davvero l'impulso: e' l'unico punto che tocca il PWM.
void servoApply(int deg) {
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;
  servoCurrentDeg = deg;   // logico: e quello che la pagina mostra
  penAngle = deg;
  int fis = penInvert ? (180 - deg) : deg;
  long us = SERVO_US_MIN + (long)(SERVO_US_MAX - SERVO_US_MIN) * fis / 180;
  uint32_t duty = (uint32_t)(us * (1UL << SERVO_RES_BITS) / 20000UL);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(SERVO_CHANNEL, duty);
#endif
  servoAttached = true;
}

// Duty a zero: nessun impulso, il servo smette di tenere la posizione.
void servoRelease() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, 0);
#else
  ledcWrite(SERVO_CHANNEL, 0);
#endif
  servoAttached = false;
}

// Chiede un angolo. Con la rampa attiva non lo applica subito: fissa il
// bersaglio e ci arriva serviceServo(), un passo ogni SERVO_SLEW_MS.
void servoGoTo(int deg) {
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;
  servoTargetDeg = deg;
  if (servoSlewDeg <= 0) {
    servoApply(deg);
    return;
  }
  if (!servoAttached) servoApply(servoCurrentDeg); // riaggancia dove si era rimasti
  servoLastStepMs = millis();
}

bool servoBusy() {
  return servoAttached && servoCurrentDeg != servoTargetDeg;
}

void serviceServo() {
  if (!servoAttached || servoSlewDeg <= 0) return;
  if (servoCurrentDeg == servoTargetDeg) return;
  unsigned long now = millis();
  if (now - servoLastStepMs < SERVO_SLEW_MS) return;
  servoLastStepMs = now;
  int d = servoTargetDeg - servoCurrentDeg;
  if (d > servoSlewDeg) d = servoSlewDeg;
  else if (d < -servoSlewDeg) d = -servoSlewDeg;
  servoApply(servoCurrentDeg + d);
}

void setPen(const String& state) {
  if (state == "up") servoGoTo(penUpDeg);
  else if (state == "down") servoGoTo(penDownDeg);
  else servoRelease();
  penState = state;
  logMsg("Penna: " + state);
}

// Avvio movimento in passi, con velocità già convertita in passi al secondo.
void startMoveSteps(Motor& m, int dir, long steps, long stepsPerSec, long rampSteps) {
  if (stepsPerSec < 1) stepsPerSec = 1;
  if (stepsPerSec > STEPS_PER_SEC_MAX) stepsPerSec = STEPS_PER_SEC_MAX;

  uint32_t inc = (uint32_t)(((uint64_t)stepsPerSec * ACC_ONE) / TICK_HZ);
  if (inc == 0) inc = 1;
  if (inc > ACC_ONE) inc = ACC_ONE; // al massimo un passo per tick

  setDir(m, dir);

  portENTER_CRITICAL(&stepMux);
  m.stepsDone = 0;
  m.acc = 0;
  m.incTarget = inc;
  m.rampSteps = rampSteps;
  // Il segno va impostato DENTRO la sezione critica e non in setDir(): se l'asse
  // era in rotazione continua, fra setDir() e qui l'ISR conterebbe dei passi col
  // segno vecchio.
  m.dirSign = (dir > 0) ? 1 : -1;
  applyRamp(m);
  m.stepsRemaining = steps;
  portEXIT_CRITICAL(&stepMux);
}

// Avvio movimento usando la velocità e la rampa configurate per quell'asse.
void startMove(Motor& m, int dir, long steps) {
  float spmm = stepsPerMm(m);
  startMoveSteps(m, dir, steps, (long)(m.feedMmS * spmm), (long)(m.rampMm * spmm));
}

// Posizione dell'asse in millimetri, dall'ultimo azzeramento.
float posMm(const Motor& m) {
  return (float)m.posSteps / stepsPerMm(m);
}

void zeroPos(Motor& m) {
  portENTER_CRITICAL(&stepMux);
  m.posSteps = 0;
  portEXIT_CRITICAL(&stepMux);
  m.posNota = true;   // da qui in poi il contatore significa qualcosa
}

void stopMotor(Motor& m) {
  portENTER_CRITICAL(&stepMux);
  m.stepsRemaining = 0;
  portEXIT_CRITICAL(&stepMux);
}

// ---------------------------------------------------------------------------
// Prove d'insieme: quadrato e cerchio
// ---------------------------------------------------------------------------
// Ricalcano gcode/test/quadrato-e-cerchio-penna.gcode — stessa sequenza, stesse
// pause, stessi movimenti di penna — ma senza interprete G-code: servono solo a
// vedere i due assi e il servo muoversi insieme prima di montare la macchina.
// Le coordinate sono in millimetri e diventano passi al momento dell'esecuzione,
// quindi restano giuste qualunque microstep sia impostato.
//
// L'origine della prova è il punto in cui si trova la macchina quando si preme il
// pulsante, e la posizione è tenuta in PASSI, non in millimetri: così l'ultimo
// movimento torna esattamente al punto di partenza invece di accumulare l'errore
// di arrotondamento di ogni tratto.

#define DEMO_NONE 0
#define DEMO_SQUARE 1
#define DEMO_CIRCLE 2

const float DEMO_SIDE_MM = 40.0f;
const float DEMO_RADIUS_MM = 20.0f;
const int DEMO_ARCS = 72; // il cerchio come poligono: un tratto ogni 5 gradi
const float DEMO_FEED_MM_S = 12.0f;
const float DEMO_RAPID_MM_S = 25.0f;
const unsigned long DEMO_DWELL_MS = 300;

int demoKind = DEMO_NONE;
int demoIndex = 0;
long demoPosX = 0;
long demoPosY = 0;
unsigned long demoWaitUntil = 0;

int demoTotal(int kind) {
  if (kind == DEMO_SQUARE) return 12;
  if (kind == DEMO_CIRCLE) return 9 + DEMO_ARCS;
  return 0;
}

const char* demoName(int kind) {
  if (kind == DEMO_SQUARE) return "quadrato 40 mm";
  if (kind == DEMO_CIRCLE) return "cerchio R20";
  return "nessuna";
}

bool demoStepAt(int kind, int i, DemoStep& s) {
  s.x = 0;
  s.y = 0;
  if (kind == DEMO_SQUARE) {
    switch (i) {
      case 0: s.op = 3; return true;                            // penna su
      case 1: s.op = 5; return true;                            // pausa
      case 2: s.op = 1; return true;                            // rapido all'origine
      case 3: s.op = 4; return true;                            // penna giù
      case 4: s.op = 5; return true;
      case 5: s.op = 2; s.x = DEMO_SIDE_MM; return true;        // lato inferiore
      case 6: s.op = 2; s.x = DEMO_SIDE_MM; s.y = DEMO_SIDE_MM; return true;
      case 7: s.op = 2; s.y = DEMO_SIDE_MM; return true;
      case 8: s.op = 2; return true;                            // ritorno all'origine
      case 9: s.op = 3; return true;
      case 10: s.op = 5; return true;
      default: s.op = 0; return true;
    }
  }
  if (kind == DEMO_CIRCLE) {
    if (i == 0) { s.op = 3; return true; }
    if (i == 1) { s.op = 5; return true; }
    if (i == 2) { s.op = 1; s.x = DEMO_RADIUS_MM; return true; } // sul bordo
    if (i == 3) { s.op = 4; return true; }
    if (i == 4) { s.op = 5; return true; }
    if (i >= 5 && i < 5 + DEMO_ARCS) {
      int k = i - 4; // 1..DEMO_ARCS, antiorario come nel G-code
      float a = 2.0f * 3.14159265f * (float)k / (float)DEMO_ARCS;
      s.op = 2;
      s.x = DEMO_RADIUS_MM * cosf(a);
      s.y = DEMO_RADIUS_MM * sinf(a);
      return true;
    }
    if (i == 5 + DEMO_ARCS) { s.op = 3; return true; }
    if (i == 6 + DEMO_ARCS) { s.op = 5; return true; }
    if (i == 7 + DEMO_ARCS) { s.op = 1; return true; }          // ritorno al centro
    s.op = 0;
    return true;
  }
  s.op = 0;
  return true;
}

// Movimento coordinato: i due assi partono insieme e arrivano insieme, perché
// ciascuno riceve la frequenza che gli serve per coprire la propria parte nello
// stesso tempo. Niente rampa qui: a 12 mm/s il motore parte a 32 passi interi al
// secondo, che aggancia da fermo, e una rampa diversa sui due assi storcerebbe il
// tratto proprio nei primi millimetri.
void demoGoTo(float x, float y, float feed) {
  // Una conversione per asse: i due pignoni hanno due mmPerRev tarati diversi,
  // quindi lo stesso numero di millimetri non vale lo stesso numero di passi.
  float spmmX = stepsPerMm(motorX);
  float spmmY = stepsPerMm(motorY);
  long tx = lroundf(x * spmmX);
  long ty = lroundf(y * spmmY);
  long dxs = tx - demoPosX;
  long dys = ty - demoPosY;
  demoPosX = tx;
  demoPosY = ty;
  if (dxs == 0 && dys == 0) return;

  float dxmm = (float)dxs / spmmX;
  float dymm = (float)dys / spmmY;
  float dist = sqrtf(dxmm * dxmm + dymm * dymm);
  float secs = dist / feed;
  if (secs < 0.001f) secs = 0.001f;

  if (dxs != 0) startMoveSteps(motorX, dxs > 0 ? 1 : -1, labs(dxs), (long)(fabsf((float)dxs) / secs), 0);
  if (dys != 0) startMoveSteps(motorY, dys > 0 ? 1 : -1, labs(dys), (long)(fabsf((float)dys) / secs), 0);
}

void demoStart(int kind) {
  demoKind = kind;
  demoIndex = 0;
  demoPosX = 0;
  demoPosY = 0;
  demoWaitUntil = 0;
  logMsg(String("Prova d'insieme: avvio ") + demoName(kind));
}

void demoStop(const char* why) {
  if (demoKind != DEMO_NONE) logMsg(String("Prova d'insieme: ") + why);
  demoKind = DEMO_NONE;
}

void serviceDemo() {
  if (demoKind == DEMO_NONE) return;
  if (motorX.stepsRemaining != 0 || motorY.stepsRemaining != 0) return;
  // Con la rampa attiva la penna impiega un tempo che dipende dall'escursione:
  // si aspetta che sia arrivata, e solo dopo parte la pausa di assestamento,
  // che nella sequenza e' sempre il passo subito successivo.
  if (servoBusy()) return;
  if (millis() < demoWaitUntil) return;

  DemoStep s;
  demoStepAt(demoKind, demoIndex, s);
  if (s.op == 0) {
    logMsg(String("Prova d'insieme: ") + demoName(demoKind) + " completata");
    demoKind = DEMO_NONE;
    return;
  }
  demoIndex++;

  switch (s.op) {
    case 1: demoGoTo(s.x, s.y, DEMO_RAPID_MM_S); break;
    case 2: demoGoTo(s.x, s.y, DEMO_FEED_MM_S); break;
    case 3: setPen("up"); demoWaitUntil = 0; break;
    case 4: setPen("down"); demoWaitUntil = 0; break;
    case 5: demoWaitUntil = millis() + DEMO_DWELL_MS; break;
  }
}

const char PAGE_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GDC CNC 2D &mdash; Pannello di controllo manuale</title>
<style>
  :root{--bg:#111;--panel:#1b1b1f;--accent:#3b82f6;--text:#eee;--muted:#999;--danger:#ef4444;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);}
  header{padding:16px;text-align:center;border-bottom:1px solid #222;}
  h1{margin:0;font-size:1.2rem;}
  .tabs{display:flex;justify-content:center;gap:8px;padding:12px;flex-wrap:wrap;}
  .tab-btn{background:var(--panel);border:1px solid #333;color:var(--text);padding:8px 16px;border-radius:8px;cursor:pointer;}
  .tab-btn.active{background:var(--accent);border-color:var(--accent);}
  .tab-content{display:none;max-width:480px;margin:0 auto;padding:16px;}
  .tab-content.active{display:block;}

  .pad{display:grid;grid-template-columns:52px 60px 60px 60px 52px;
       grid-template-rows:44px 60px 60px 60px 44px;gap:6px;justify-content:center;margin:20px auto;}
  .pad button{font-size:1.4rem;border-radius:12px;border:1px solid #333;background:var(--panel);color:var(--text);cursor:pointer;}
  .pad button:active{background:#2a2a30;}
  .pad .turn{font-size:.7rem;letter-spacing:.02em;color:var(--muted);}
  .pad .turn:active{background:#2a2a30;color:var(--text);}
  #btn-turn-up{grid-column:3;grid-row:1;}
  #btn-up{grid-column:3;grid-row:2;}
  #btn-turn-left{grid-column:1;grid-row:3;}
  #btn-left{grid-column:2;grid-row:3;}
  #btn-center{grid-column:3;grid-row:3;font-weight:bold;font-size:.9rem;}
  #btn-center:disabled{opacity:.35;cursor:not-allowed;}
  #btn-right{grid-column:4;grid-row:3;}
  #btn-turn-right{grid-column:5;grid-row:3;}
  #btn-down{grid-column:3;grid-row:4;}
  #btn-turn-down{grid-column:3;grid-row:5;}

  .led-row,.motor-row{display:flex;justify-content:center;gap:8px;margin:12px auto 0;}
  .led-row button,.motor-row button{padding:10px 16px;border-radius:10px;border:1px solid #333;background:var(--panel);color:var(--text);cursor:pointer;}
  #btn-led-red.on{background:var(--danger);border-color:var(--danger);color:#2a0505;}
  #btn-led-yellow.on{background:#eab308;border-color:#eab308;color:#2a2205;}
  #btn-led-green.on{background:#22c55e;border-color:#22c55e;color:#04150a;}
  .status{text-align:center;color:var(--muted);font-size:.9rem;margin-top:8px;}

  .axes{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .axis-card{background:var(--panel);border:1px solid #333;border-radius:10px;padding:12px;}
  .axis-card h3{margin:0 0 4px;font-size:1rem;}
  .axis-card .pins{font-size:.72rem;color:var(--muted);margin:0 0 10px;}
  .slider-label{display:flex;justify-content:space-between;align-items:baseline;font-size:.8rem;color:var(--muted);margin-top:10px;}
  .slider-label b{color:var(--text);font-size:.85rem;}
  input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:#333;outline:none;margin:8px 0 2px;}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:var(--accent);cursor:pointer;border:none;}
  input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--accent);cursor:pointer;border:none;}
  .axis-run{display:flex;gap:6px;margin-top:12px;}
  .axis-run button{flex:1;padding:9px 0;border-radius:8px;border:1px solid #333;background:#0e0e11;color:var(--text);cursor:pointer;font-size:1rem;}

  form label,.field label{display:block;margin:12px 0 4px;font-size:.9rem;color:var(--muted);}
  input[type=text],input[type=password],input[type=number],select{width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#0e0e11;color:var(--text);}
  .axis-card input[type=number]{padding:7px;font-size:.9rem;}
  button.primary{margin-top:16px;width:100%;padding:12px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:1rem;cursor:pointer;}
  button.danger{background:var(--danger);}
  button.ghost{padding:8px 12px;border-radius:8px;border:1px solid #333;background:var(--panel);color:var(--text);cursor:pointer;font-size:.85rem;}
  .presets{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
  .info{background:var(--panel);border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:12px;font-size:.9rem;line-height:1.5;}
  .msg{margin-top:12px;font-size:.9rem;text-align:center;}
  .placeholder{color:var(--muted);text-align:center;padding:32px 0;}
  .log-view{background:#0e0e11;border:1px solid #333;border-radius:8px;padding:10px;height:300px;overflow-y:auto;font-family:monospace;font-size:.8rem;white-space:pre-wrap;word-break:break-word;margin:0;}
  .check{display:flex;align-items:center;gap:8px;margin-top:16px;font-size:.9rem;color:var(--muted);}
  .hint{font-size:.78rem;color:var(--muted);margin-top:6px;line-height:1.4;}
  /* Una posizione non nota non e' un dettaglio: cambia colore, perche' e' la
     differenza fra un numero di cui fidarsi e uno da buttare. */
  .posko{color:#f59e0b;}
  details{margin-top:16px;border-top:1px solid #222;padding-top:12px;}
  summary{cursor:pointer;font-size:.9rem;color:var(--muted);}
</style>
</head>
<body>
<header><h1>GDC CNC 2D &mdash; Pannello di controllo manuale</h1></header>
<div class="tabs">
  <button class="tab-btn active" data-tab="controllo">Controllo</button>
  <button class="tab-btn" data-tab="motore">Motore</button>
  <button class="tab-btn" data-tab="wifi">Wi-Fi</button>
  <button class="tab-btn" data-tab="log">Log</button>
  <button class="tab-btn" data-tab="codice">Codice</button>
</div>

<section id="controllo" class="tab-content active">
  <div class="pad">
    <button id="btn-turn-up" class="turn" onclick="fullTurn('y','up')" title="Y: un giro di pignone">1 giro</button>
    <button id="btn-up"
      onmousedown="pressStart('y','up')" onmouseup="pressEnd('y')" onmouseleave="pressEnd('y')"
      ontouchstart="pressStart('y','up')" ontouchend="pressEnd('y')">&uarr;</button>
    <button id="btn-turn-left" class="turn" onclick="fullTurn('x','left')" title="X: un giro di pignone">1 giro</button>
    <button id="btn-left"
      onmousedown="pressStart('x','left')" onmouseup="pressEnd('x')" onmouseleave="pressEnd('x')"
      ontouchstart="pressStart('x','left')" ontouchend="pressEnd('x')">&larr;</button>
    <button id="btn-center" onclick="penToggle()" title="Alza/abbassa la penna">PENNA</button>
    <button id="btn-right"
      onmousedown="pressStart('x','right')" onmouseup="pressEnd('x')" onmouseleave="pressEnd('x')"
      ontouchstart="pressStart('x','right')" ontouchend="pressEnd('x')">&rarr;</button>
    <button id="btn-turn-right" class="turn" onclick="fullTurn('x','right')" title="X: un giro di pignone">1 giro</button>
    <button id="btn-down"
      onmousedown="pressStart('y','down')" onmouseup="pressEnd('y')" onmouseleave="pressEnd('y')"
      ontouchstart="pressStart('y','down')" ontouchend="pressEnd('y')">&darr;</button>
    <button id="btn-turn-down" class="turn" onclick="fullTurn('y','down')" title="Y: un giro di pignone">1 giro</button>
  </div>
  <div class="motor-row">
    <button onclick="motorStop()" style="border-color:#ef4444;color:#ef4444">STOP</button>
  </div>
  <p class="hint" style="text-align:center" id="scale-hint">--</p>

  <div class="axis-card" style="margin-top:16px">
    <h3>Posizione</h3>
    <div class="slider-label"><span>X &mdash; trave del portale</span><b id="dro-x">0.000 mm</b></div>
    <div class="slider-label"><span>Y &mdash; rotaie di base</span><b id="dro-y">0.000 mm</b></div>
    <div class="axis-run">
      <button onclick="zeroAxis('x')">Azzera X</button>
      <button onclick="zeroAxis('y')">Azzera Y</button>
      <button onclick="zeroAxis('both')">Azzera tutto</button>
    </div>
    <p class="hint">Conta i passi che l'asse ha fatto dall'ultimo azzeramento, con il segno
      delle frecce. Non &egrave; un riferimento macchina e non sopravvive allo spegnimento:
      serve a <b>misurare</b>. Per la corsa utile di un asse: portalo a un estremo, azzera,
      portalo all'altro estremo, leggi. Vicino a fine corsa usa il passo singolo.</p>

    <div class="axis-run" style="margin-top:14px">
      <button onclick="homingFree()" style="border-color:#f59e0b;color:#f59e0b">Libera i motori</button>
      <button onclick="homingDone()" style="border-color:#3b82f6;color:#3b82f6">Homing completato</button>
    </div>
    <p class="hint"><b>Homing a mano.</b> <i>Libera i motori</i> li sblocca: da quel momento
      la posizione non &egrave; pi&ugrave; nota, perch&eacute; spostando a mano nessun impulso
      la racconta. Appoggia i carrelli ai blocchi di riferimento <b>senza forzarli</b>, poi
      <i>Homing completato</i>, che riattiva i motori e azzera. L'ordine conta: azzerare a
      motori liberi darebbe un'origine che il primo urto sposta senza dirlo.</p>
  </div>

  <div class="axis-card" style="margin-top:12px">
    <h3>Penna (servo)</h3>
    <div class="slider-label"><span>Angolo</span><b id="lbl-pen-live">90&deg;</b></div>
    <input type="range" id="pen-live" min="0" max="180" step="1" value="90" oninput="penLive()">
    <div class="axis-run">
      <button onclick="penNudge(-1)">&minus;1&deg;</button>
      <button onclick="penNudge(1)">+1&deg;</button>
    </div>
    <div class="axis-run">
      <button onclick="penSet('up')">Alza</button>
      <button onclick="penSet('down')">Abbassa</button>
      <button onclick="penSet('free')">Rilascia</button>
    </div>
    <p class="status" id="pen-status" style="margin-top:8px">--</p>
    <p class="hint">Lo slider muove il servo mentre lo trascini, senza salvare niente: serve a
      vedere dove va la penna. I due pulsanti da un grado servono per le <b>misure</b>: un grado
      vale 0,327 mm di penna, ed &egrave; il passo giusto per trovare la battuta dei cuscinetti e
      il punto in cui la punta tocca. Sotto il grado non ha senso andare &mdash; la banda morta
      del servo vale circa un grado da sola. Gli angoli di lavoro alzata/abbassata si tarano e si
      salvano nella tab Motore, insieme alla dolcezza del movimento. "Rilascia" toglie il segnale
      e il servo si ammorbidisce.</p>
  </div>

  <div class="axis-card" style="margin-top:12px">
    <h3>Prove d'insieme</h3>
    <div class="axis-run">
      <button onclick="demoStart('square')">Quadrato 40 mm</button>
      <button onclick="demoStart('circle')">Cerchio R20</button>
    </div>
    <button class="primary danger" onclick="demoStop()">INTERROMPI PROVA</button>
    <p class="status" id="demo-status" style="margin-top:8px">--</p>
    <p class="hint">Le stesse due figure dei file in <code>gcode/test/</code>, penna compresa,
      eseguite dal firmware senza G-code. Partono dal punto in cui si trova la macchina
      e ci tornano alla fine. Servono a vedere i due assi e il servo muoversi insieme:
      non usarle a macchina smontata se i motori sono vincolati a qualcosa.</p>
  </div>

  <div class="led-row">
    <button id="btn-led-red" onclick="toggleLed('red')">Rosso</button>
    <button id="btn-led-yellow" onclick="toggleLed('yellow')">Giallo</button>
    <button id="btn-led-green" onclick="toggleLed('green')">Verde</button>
  </div>
  <p class="status" id="led-status">Stato LED: --</p>
  <p class="status" id="motor-status">Motori: --</p>
</section>

<section id="motore" class="tab-content">
  <div class="axis-card">
    <h3>Trasmissione</h3>
    <label for="micro" style="margin-top:4px">Microstep impostati sul driver</label>
    <select id="micro" onchange="pushMicro()">
      <option value="1">1 (passo intero)</option>
      <option value="2">1/2</option>
      <option value="4">1/4</option>
      <option value="8">1/8</option>
      <option value="16" selected>1/16</option>
      <option value="32">1/32</option>
    </select>
    <p class="hint" id="micro-hint">--</p>
    <p class="hint">Dipende dai ponticelli MS1/MS2/MS3 sul driver, che il firmware non pu&ograve;
      leggere. Se non sei sicuro: premi "1 giro" e guarda l'albero. Se fa un giro intero il
      valore &egrave; giusto; se fa un sedicesimo di giro i ponticelli sono a 1/16 e qui c'&egrave; 1.</p>
  </div>

  <div class="axes" style="margin-top:12px">
    <div class="axis-card">
      <h3>Asse X</h3>
      <p class="pins">STEP D4 &middot; DIR D26 &middot; carrello sulla trave &mdash; sinistra/destra sul foglio</p>

      <div class="slider-label"><span>Velocit&agrave;</span><b id="lbl-feed-x">20 mm/s</b></div>
      <input type="range" id="feed-x" min="1" max="100" step="1" value="20"
             oninput="showFeed('x')" onchange="pushAxis('x')">

      <div class="slider-label"><span>Accelerazione</span><b id="lbl-ramp-x">3 mm</b></div>
      <input type="range" id="ramp-x" min="0" max="20" step="1" value="3"
             oninput="showRamp('x')" onchange="pushAxis('x')">

      <div class="slider-label"><span>Distanza (mm)</span></div>
      <input type="number" id="mm-x" min="0.1" max="400" step="0.1" value="50">

      <div class="check" style="margin-top:12px">
        <input type="checkbox" id="inv-x" onchange="pushInvert('x')">
        <label for="inv-x" style="margin:0;font-size:.8rem">Inverti direzione</label>
      </div>

      <div class="axis-run">
        <button onclick="runAxis('x','left')">&larr;</button>
        <button onclick="runAxis('x','right')">&rarr;</button>
      </div>
      <p class="status" id="stat-x" style="margin-top:8px;font-size:.78rem">--</p>

      <div class="slider-label"><span>Posizione</span><b id="pos-x">0.000 mm</b></div>
      <button class="ghost" style="width:100%;margin-top:6px" onclick="zeroAxis('x')">Azzera posizione</button>

      <div class="slider-label"><span>Rapporto tarato</span><b id="mmrev-x">--</b></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="number" id="cmd-x" min="10" max="400" step="0.01" value="200" title="millimetri comandati">
        <input type="number" id="meas-x" min="1" max="400" step="0.01" placeholder="misurati" title="millimetri misurati col calibro">
      </div>
      <div class="axis-run" style="margin-top:6px">
        <button onclick="calibAxis('x')">Calcola e salva</button>
        <button onclick="resetMmRev('x')">Nominale</button>
      </div>
      <p class="hint">Comanda i millimetri del primo campo <b>in un senso solo</b>, misura col
        calibro quanto si &egrave; spostato davvero e scrivilo nel secondo. Lungo: su 200 mm un
        decimo di errore di lettura vale lo 0,05%, su 20 mm vale lo 0,5%. Senza tornare
        indietro, altrimenti ci metti dentro anche il gioco. Salvando, la posizione si azzera:
        contava in passi col rapporto vecchio.</p>
    </div>

    <div class="axis-card">
      <h3>Asse Y</h3>
      <p class="pins">STEP D25 &middot; DIR D33 &middot; portale sulle rotaie &mdash; basso/alto sul foglio</p>

      <div class="slider-label"><span>Velocit&agrave;</span><b id="lbl-feed-y">20 mm/s</b></div>
      <input type="range" id="feed-y" min="1" max="100" step="1" value="20"
             oninput="showFeed('y')" onchange="pushAxis('y')">

      <div class="slider-label"><span>Accelerazione</span><b id="lbl-ramp-y">3 mm</b></div>
      <input type="range" id="ramp-y" min="0" max="20" step="1" value="3"
             oninput="showRamp('y')" onchange="pushAxis('y')">

      <div class="slider-label"><span>Distanza (mm)</span></div>
      <input type="number" id="mm-y" min="0.1" max="400" step="0.1" value="50">

      <div class="check" style="margin-top:12px">
        <input type="checkbox" id="inv-y" onchange="pushInvert('y')">
        <label for="inv-y" style="margin:0;font-size:.8rem">Inverti direzione</label>
      </div>

      <div class="axis-run">
        <button onclick="runAxis('y','down')">&darr;</button>
        <button onclick="runAxis('y','up')">&uarr;</button>
      </div>
      <p class="status" id="stat-y" style="margin-top:8px;font-size:.78rem">--</p>

      <div class="slider-label"><span>Posizione</span><b id="pos-y">0.000 mm</b></div>
      <button class="ghost" style="width:100%;margin-top:6px" onclick="zeroAxis('y')">Azzera posizione</button>

      <div class="slider-label"><span>Rapporto tarato</span><b id="mmrev-y">--</b></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="number" id="cmd-y" min="10" max="400" step="0.01" value="200" title="millimetri comandati">
        <input type="number" id="meas-y" min="1" max="400" step="0.01" placeholder="misurati" title="millimetri misurati col calibro">
      </div>
      <div class="axis-run" style="margin-top:6px">
        <button onclick="calibAxis('y')">Calcola e salva</button>
        <button onclick="resetMmRev('y')">Nominale</button>
      </div>
      <p class="hint">Comanda i millimetri del primo campo <b>in un senso solo</b>, misura col
        calibro quanto si &egrave; spostato davvero e scrivilo nel secondo. Lungo: su 200 mm un
        decimo di errore di lettura vale lo 0,05%, su 20 mm vale lo 0,5%. Senza tornare
        indietro, altrimenti ci metti dentro anche il gioco. Salvando, la posizione si azzera:
        contava in passi col rapporto vecchio.</p>
    </div>
  </div>

  <div class="axis-card" style="margin-top:12px">
    <h3>Penna (servo) &mdash; taratura</h3>
    <p class="pins">Segnale D32 &middot; alimentazione 5 V separata</p>

    <div class="slider-label"><span>Angolo penna alzata</span><b id="lbl-pen-up">90&deg;</b></div>
    <input type="range" id="pen-up" min="0" max="180" step="1" value="90"
           oninput="showPen()" onchange="pushPen('up')">

    <div class="slider-label"><span>Angolo penna abbassata</span><b id="lbl-pen-down">60&deg;</b></div>
    <input type="range" id="pen-down" min="0" max="180" step="1" value="60"
           oninput="showPen()" onchange="pushPen('down')">

    <div class="check">
      <input type="checkbox" id="pen-invert" checked onchange="pushPenInvert()">
      <label for="pen-invert" style="margin:0">Verso del servo invertito</label>
    </div>
    <p class="hint">Sul modulo montato il 2026-10-21 l'accoppiamento esce invertito: facendo
      crescere l'angolo fisico la penna <b>scende</b>. Con la spunta, i gradi che vedi
      ovunque — slider, pulsanti da un grado, angoli salvati — sono <b>gradi logici</b>:
      pi&ugrave; gradi = penna pi&ugrave; in alto, sempre. La conversione la fa il firmware in un
      punto solo, e resta valida la regola del progetto
      <b>battuta &lt; abbassata &lt; alzata</b>. Togli la spunta solo se rimonti il servo
      dall'altra parte.</p>

    <div class="slider-label"><span>Passo della rampa &mdash; pi&ugrave; basso = pi&ugrave; morbido</span><b id="lbl-slew">2&deg;/10 ms</b></div>
    <input type="range" id="slew" min="0" max="10" step="1" value="2"
           oninput="showSlew()" onchange="pushSlew()">
    <p class="hint" id="slew-hint">--</p>

    <div class="axis-run">
      <button onclick="penSet('up')">Alza</button>
      <button onclick="penSet('down')">Abbassa</button>
      <button onclick="penSet('free')">Rilascia</button>
    </div>
    <p class="hint">Rilasciando uno slider il servo si porta subito su quell'angolo, cos&igrave;
      puoi tarare guardando la penna. Questi due valori sono salvati in memoria non volatile
      e sono quelli che usano il pulsante PENNA e le prove d'insieme.</p>
  </div>

  <p class="hint"><b>Velocit&agrave;</b>: millimetri al secondo di corsa del carrello.
    <b>Accelerazione</b>: su quanti millimetri si distribuisce la partenza &mdash; 0 significa
    partenza secca. Senza rampa un motore fermo pu&ograve; non riuscire ad agganciare la
    frequenza di partenza e limitarsi a vibrare.</p>

  <button class="primary" onclick="runBoth()">Esegui i due assi insieme</button>
  <button class="primary danger" onclick="motorStop()">STOP</button>

  <div class="check">
    <input type="checkbox" id="drv-enabled" checked onchange="pushEnable()">
    <label for="drv-enabled" style="margin:0">Driver abilitati (ENABLE condiviso su D27)</label>
  </div>
  <p class="hint">Togliendo la spunta entrambi i motori si sbloccano e smettono di scaldare.
    <b>La posizione diventa non nota</b>: a motori liberi l'asse si sposta a mano e il
    contatore non se ne accorge, perch&eacute; conta gli impulsi mandati, non i giri fatti.
    Per l'homing usa i due pulsanti nella scheda Posizione, che fanno i gesti nell'ordine giusto.</p>

  <details>
    <summary>Test pin (misura col multimetro)</summary>
    <div class="presets">
      <button class="ghost" onclick="setPin('stepx',0)">STEP X 0 V</button>
      <button class="ghost" onclick="setPin('stepx',1)">STEP X 3,3 V</button>
      <button class="ghost" onclick="setPin('dirx',0)">DIR X 0 V</button>
      <button class="ghost" onclick="setPin('dirx',1)">DIR X 3,3 V</button>
    </div>
    <div class="presets">
      <button class="ghost" onclick="setPin('stepy',0)">STEP Y 0 V</button>
      <button class="ghost" onclick="setPin('stepy',1)">STEP Y 3,3 V</button>
      <button class="ghost" onclick="setPin('diry',0)">DIR Y 0 V</button>
      <button class="ghost" onclick="setPin('diry',1)">DIR Y 3,3 V</button>
    </div>
    <div class="presets">
      <button class="ghost" onclick="setPin('en',0)">EN 0 V</button>
      <button class="ghost" onclick="setPin('en',1)">EN 3,3 V</button>
    </div>
    <p class="hint">Puntale nero su un GND, puntale rosso sul pin del driver. Dopo aver usato
      questi pulsanti riporta gli STEP a 0 V, altrimenti il primo impulso successivo va perso.</p>
  </details>
</section>

<section id="wifi" class="tab-content">
  <div class="info" id="wifi-info">Caricamento stato rete...</div>
  <form id="wifi-form">
    <label>Nome rete (SSID)</label>
    <input type="text" id="ssid" placeholder="Nome rete Wi-Fi" required>
    <label>Password</label>
    <input type="password" id="password" placeholder="Nuova password">
    <button type="submit" class="primary">Salva e riavvia</button>
  </form>
  <p class="msg" id="wifi-msg"></p>
</section>

<section id="log" class="tab-content">
  <pre id="log-view" class="log-view"></pre>
</section>

<section id="codice" class="tab-content">
  <div class="placeholder">
    Caricamento G-code via web: disponibile dopo il test di motori e servo (Step 2-3 della pipeline).
  </div>
</section>

<script>
function $(id){return document.getElementById(id);}

document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  });
});

var holdTimer = null;
var holding = null;

function pressStart(axis, dir){
  holding = null;
  fetch('/api/motor/step?axis=' + axis + '&dir=' + dir);
  holdTimer = setTimeout(function(){
    holding = axis;
    fetch('/api/motor/start?axis=' + axis + '&dir=' + dir);
  }, 300);
}

function pressEnd(axis){
  clearTimeout(holdTimer);
  if (holding === axis) {
    fetch('/api/motor/stop?axis=' + axis);
    holding = null;
  }
}

function fullTurn(axis, dir){
  fetch('/api/motor/full?axis=' + axis + '&dir=' + dir);
}

function showFeed(a){ $('lbl-feed-' + a).textContent = $('feed-' + a).value + ' mm/s'; }
function showRamp(a){
  var v = $('ramp-' + a).value;
  $('lbl-ramp-' + a).textContent = (v === '0') ? 'nessuna' : v + ' mm';
}

function pushAxis(a){
  fetch('/api/motor/config?axis=' + a + '&feed=' + $('feed-' + a).value + '&ramp=' + $('ramp-' + a).value);
}

function zeroAxis(a){
  fetch('/api/motor/zero?axis=' + a).then(refreshState).then(refreshLog);
}

function calibAxis(a){
  var cmd = parseFloat($('cmd-' + a).value);
  var meas = parseFloat($('meas-' + a).value);
  if (!(cmd >= 10) || !(meas >= 1)) {
    alert('Serve un movimento comandato di almeno 10 mm e la misura col calibro.');
    return;
  }
  fetch('/api/motor/calib?axis=' + a + '&cmd=' + cmd + '&meas=' + meas)
    .then(function(r){
      if (!r.ok) return r.text().then(function(t){ alert('Taratura rifiutata: ' + t); });
      $('meas-' + a).value = '';
    })
    .then(refreshState).then(refreshLog);
}

function resetMmRev(a){
  if (!confirm('Riporto l\'asse ' + a.toUpperCase() + ' al rapporto nominale, perdendo la taratura. Procedo?')) return;
  fetch('/api/motor/mmrev?axis=' + a + '&v=0').then(refreshState).then(refreshLog);
}

function pushMicro(){
  fetch('/api/motor/micro?n=' + $('micro').value);
}

function showSlew(){
  var v = parseInt($('slew').value, 10);
  var nome = (v === 0) ? "salto secco"
           : (v <= 2) ? "molto morbido"
           : (v <= 5) ? "morbido" : "quasi secco";
  $('lbl-slew').textContent = (v === 0) ? "0 \u2014 salto secco" : (v + "\u00B0/10 ms \u2014 " + nome);
  $('slew-hint').textContent = (v === 0)
    ? "Il servo salta all'angolo richiesto alla corrente massima: e' la condizione che fa cadere il 5 V. Per la prova piu' dolce metti 1, non 10."
    : ("Circa " + (v * 100) + "\u00B0/s. Un'escursione di 30\u00B0 ci mette " + Math.round(300 / v) +
       " ms. Sopra i ~600\u00B0/s nessun servo riesce comunque a seguire, quindi da li' in su equivale al salto secco.");
}

function pushSlew(){
  fetch('/api/pen/slew?deg=' + $('slew').value);
}

function showPen(){
  $('lbl-pen-up').textContent = $('pen-up').value + '°';
  $('lbl-pen-down').textContent = $('pen-down').value + '°';
}

function pushPenInvert(){
  fetch('/api/pen/invert?on=' + ($('pen-invert').checked ? 1 : 0));
}

function pushPen(which){
  fetch('/api/pen/config?up=' + $('pen-up').value + '&down=' + $('pen-down').value + '&preview=' + which);
}

// Lo slider dal vivo manda al massimo una richiesta ogni 70 ms: il server web
// dell'ESP32 serve una richiesta alla volta, e trascinando il dito ne partirebbero
// decine al secondo che si accodano, facendo arrivare il servo in ritardo sul dito.
var penTimer = null;
var penPending = null;

function penLive(){
  var v = $('pen-live').value;
  $('lbl-pen-live').textContent = v + '°';
  penPending = v;
  if (penTimer) return;
  penTimer = setInterval(function(){
    if (penPending === null){ clearInterval(penTimer); penTimer = null; return; }
    fetch('/api/pen/angle?deg=' + penPending);
    penPending = null;
  }, 70);
}

function penSet(state){
  fetch('/api/pen/set?state=' + state);
}

/* Un grado alla volta, per le misure. Parte dall'angolo mostrato dallo slider,
   non da quello dell'ultimo stato ricevuto: altrimenti due click veloci
   finirebbero sullo stesso punto di partenza e il secondo non farebbe niente. */
function penNudge(d){
  var v = parseInt($('pen-live').value, 10) + d;
  if (v < 0) v = 0;
  if (v > 180) v = 180;
  $('pen-live').value = v;
  penLive();
}

function penToggle(){
  fetch('/api/pen/set?state=toggle');
}

function demoStart(what){
  fetch('/api/demo/start?what=' + what);
}

function demoStop(){
  fetch('/api/demo/stop');
}

function pushInvert(a){
  fetch('/api/motor/invert?axis=' + a + '&on=' + ($('inv-' + a).checked ? 1 : 0));
}

function pushEnable(){
  fetch('/api/motor/enable?on=' + ($('drv-enabled').checked ? 1 : 0));
}

function setPin(pin, level){
  fetch('/api/pin/set?pin=' + pin + '&level=' + level);
}

function runAxis(axis, dir){
  fetch('/api/motor/run?axis=' + axis + '&dir=' + dir + '&mm=' + $('mm-' + axis).value);
}

function runBoth(){
  fetch('/api/motor/run?axis=x&dir=right&mm=' + $('mm-x').value);
  fetch('/api/motor/run?axis=y&dir=up&mm=' + $('mm-y').value);
}

function motorStop(){
  fetch('/api/motor/stop?axis=both');
}

/* La conferma compare solo se c'e' davvero un'origine da perdere: a posizione
   gia' non nota sarebbe un clic in piu' e basta. */
function homingFree(){
  if (statoUltimo && (statoUltimo.x.posNota || statoUltimo.y.posNota)) {
    if (!confirm('Liberando i motori la posizione attuale viene persa. Procedo?')) return;
  }
  fetch('/api/homing/free').then(refreshState);
}

function homingDone(){
  fetch('/api/homing/done').then(refreshState);
}

function applyAxis(a, s){
  $('stat-' + a).textContent = s.done + ' passi · ' +
    (s.remaining < 0 ? 'continuo' : s.remaining + ' mancanti');
  /* Quando la posizione non e' nota si mostra che non lo e', invece di un
     numero con tre decimali che sembra una misura e non lo e' piu'. */
  var testo = s.posNota ? (s.pos.toFixed(3) + ' mm') : '\u2014 non nota';
  ['pos-' + a, 'dro-' + a].forEach(function(id){
    $(id).textContent = testo;
    $(id).classList.toggle('posko', !s.posNota);
  });
  $('mmrev-' + a).textContent = s.mmPerRev.toFixed(4) + ' mm/giro · ' +
    s.spmm.toFixed(3) + ' passi/mm';
  if (document.activeElement !== $('feed-' + a)) {
    $('feed-' + a).value = s.feed;
    showFeed(a);
  }
  if (document.activeElement !== $('ramp-' + a)) {
    $('ramp-' + a).value = s.ramp;
    showRamp(a);
  }
  $('inv-' + a).checked = s.invert;
}

/* L'ultimo stato ricevuto, per le decisioni che dipendono da com'e' adesso la
   macchina invece che da quello che l'utente ha appena cliccato. */
var statoUltimo = null;

function applyState(s){
  statoUltimo = s;
  $('btn-led-red').classList.toggle('on', s.ledRed);
  $('btn-led-yellow').classList.toggle('on', s.ledYellow);
  $('btn-led-green').classList.toggle('on', s.ledGreen);
  $('led-status').textContent = 'LED — Rosso: ' + (s.ledRed ? 'ACCESO' : 'SPENTO') +
    ' | Giallo: ' + (s.ledYellow ? 'ACCESO' : 'SPENTO') +
    ' | Verde: ' + (s.ledGreen ? 'ACCESO' : 'SPENTO');

  var moving = (s.x.remaining !== 0 || s.y.remaining !== 0);
  $('motor-status').textContent = 'Motori: ' + (moving ? 'in movimento' : 'fermi') +
    ' | driver ' + (s.enabled ? 'abilitati' : 'disabilitati');

  applyAxis('x', s.x);
  applyAxis('y', s.y);

  if (document.activeElement !== $('micro')) $('micro').value = s.micro;
  var perStepX = s.x.mmPerRev / (200 * s.micro);
  var perStepY = s.y.mmPerRev / (200 * s.micro);
  var scartoX = (s.x.mmPerRev / s.mmPerRevNom - 1) * 100;
  var scartoY = (s.y.mmPerRev / s.mmPerRevNom - 1) * 100;
  $('micro-hint').textContent = 'Nominale ' + s.mmPerRevNom.toFixed(4) + ' mm/giro · ' +
    'X ' + s.x.spmm.toFixed(3) + ' passi/mm (' + (scartoX >= 0 ? '+' : '') + scartoX.toFixed(2) + '%) · ' +
    'Y ' + s.y.spmm.toFixed(3) + ' passi/mm (' + (scartoY >= 0 ? '+' : '') + scartoY.toFixed(2) + '%)';
  $('scale-hint').textContent = 'Un click = ' + perStepX.toFixed(4) + ' mm su X, ' +
    perStepY.toFixed(4) + ' su Y · "1 giro" = ' + s.x.mmPerRev.toFixed(1) + ' / ' +
    s.y.mmPerRev.toFixed(1) + ' mm';

  if (document.activeElement !== $('pen-up')) $('pen-up').value = s.pen.up;
  if (document.activeElement !== $('pen-down')) $('pen-down').value = s.pen.down;
  if (document.activeElement !== $('slew')) $('slew').value = s.pen.slew;
  showSlew();
  $('pen-status').textContent = (s.pen.state === 'free')
    ? "Servo rilasciato (nessun impulso)"
    : (s.pen.moving
        ? ("In movimento: " + s.pen.angle + "\u00B0 \u2192 " + s.pen.target + "\u00B0")
        : ("Fermo a " + s.pen.angle + "\u00B0"));
  if (document.activeElement !== $('pen-live') && penPending === null) {
    $('pen-live').value = s.pen.angle;
    $('lbl-pen-live').textContent = s.pen.angle + '°';
  }
  showPen();
  $('btn-center').textContent = (s.pen.state === 'down') ? 'GIÙ' : 'PENNA';
  $('drv-enabled').checked = s.enabled;
  $('pen-invert').checked = s.pen.invert;
  $('demo-status').textContent = s.demo.running
    ? ('In corso: ' + s.demo.name + ' — tratto ' + s.demo.step + '/' + s.demo.total)
    : 'Nessuna prova in corso';

  $('wifi-info').innerHTML = 'Modalità: <b>' + s.mode + '</b><br>Rete: <b>' + s.ssid + '</b><br>IP: <b>' + s.ip + '</b>';
}

function refreshState(){
  fetch('/api/state').then(function(r){return r.json();}).then(applyState).catch(function(){});
}

function toggleLed(color){
  fetch('/api/led/' + color + '/toggle').then(function(r){return r.json();}).then(applyState);
}

function refreshLog(){
  fetch('/api/log').then(function(r){return r.text();}).then(function(t){
    var el = $('log-view');
    var atBottom = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 20);
    el.textContent = t;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }).catch(function(){});
}

$('wifi-form').addEventListener('submit', function(e){
  e.preventDefault();
  var ssid = $('ssid').value;
  var password = $('password').value;
  $('wifi-msg').textContent = 'Salvataggio in corso...';
  fetch('/api/wifi/save', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'ssid=' + encodeURIComponent(ssid) + '&password=' + encodeURIComponent(password)
  }).then(function(r){return r.text();}).then(function(t){
    $('wifi-msg').textContent = t + ' Il dispositivo si riavvierà tra pochi secondi.';
  }).catch(function(){
    $('wifi-msg').textContent = 'Errore di rete durante il salvataggio.';
  });
});

refreshState();
setInterval(refreshState, 2000);
refreshLog();
setInterval(refreshLog, 3000);
</script>
</body>
</html>
)rawliteral";

String axisJson(const Motor& m) {
  return "{\"remaining\":" + String((long)m.stepsRemaining) +
         ",\"done\":" + String((long)m.stepsDone) +
         ",\"feed\":" + String(m.feedMmS, 1) +
         ",\"ramp\":" + String(m.rampMm, 1) +
         ",\"pos\":" + String(posMm(m), 3) +
         ",\"posSteps\":" + String((long)m.posSteps) +
         ",\"posNota\":" + String(m.posNota ? "true" : "false") +
         ",\"mmPerRev\":" + String(m.mmPerRev, 4) +
         ",\"spmm\":" + String(stepsPerMm(m), 4) +
         ",\"invert\":" + String(m.invert ? "true" : "false") + "}";
}

void sendStateJson() {
  String json = "{\"ledRed\":" + String(ledRedState ? "true" : "false") +
                ",\"ledYellow\":" + String(ledYellowState ? "true" : "false") +
                ",\"ledGreen\":" + String(ledGreenState ? "true" : "false") +
                ",\"enabled\":" + String(driverEnabled ? "true" : "false") +
                ",\"micro\":" + String(microsteps) +
                ",\"mmPerRevNom\":" + String(MM_PER_REV, 4) +
                ",\"pen\":{\"up\":" + String(penUpDeg) +
                ",\"down\":" + String(penDownDeg) +
                ",\"angle\":" + String(penAngle) +
                ",\"target\":" + String(servoTargetDeg) +
                ",\"slew\":" + String(servoSlewDeg) +
                ",\"invert\":" + String(penInvert ? "true" : "false") +
                ",\"moving\":" + String(servoBusy() ? "true" : "false") +
                ",\"state\":\"" + penState + "\"}" +
                ",\"demo\":{\"running\":" + String(demoKind != DEMO_NONE ? "true" : "false") +
                ",\"name\":\"" + String(demoName(demoKind)) + "\"" +
                ",\"step\":" + String(demoIndex) +
                ",\"total\":" + String(demoTotal(demoKind)) + "}" +
                ",\"x\":" + axisJson(motorX) +
                ",\"y\":" + axisJson(motorY) +
                ",\"mode\":\"" + String(apMode ? "AP" : "STA") + "\"" +
                ",\"ssid\":\"" + (apMode ? String(AP_SSID) : WiFi.SSID()) + "\"" +
                ",\"ip\":\"" + (apMode ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + "\"}";
  server.send(200, "application/json", json);
}

void handleRoot() {
  server.send_P(200, "text/html", PAGE_HTML);
}

void handleLedRedToggle() {
  ledRedState = !ledRedState;
  digitalWrite(RED_LED_PIN, ledRedState ? HIGH : LOW);
  logMsg(String("LED rosso: ") + (ledRedState ? "ACCESO" : "SPENTO"));
  sendStateJson();
}

void handleLedYellowToggle() {
  ledYellowState = !ledYellowState;
  digitalWrite(YELLOW_LED_PIN, ledYellowState ? HIGH : LOW);
  logMsg(String("LED giallo: ") + (ledYellowState ? "ACCESO" : "SPENTO"));
  sendStateJson();
}

void handleLedGreenToggle() {
  ledGreenState = !ledGreenState;
  digitalWrite(GREEN_LED_PIN, ledGreenState ? HIGH : LOW);
  logMsg(String("LED verde: ") + (ledGreenState ? "ACCESO" : "SPENTO"));
  sendStateJson();
}

void handleState() {
  sendStateJson();
}

void handleLog() {
  server.send(200, "text/plain", logBuffer);
}

// "right" e "up" sono il verso positivo, tutto il resto è negativo.
int dirFromArg() {
  String d = server.arg("dir");
  return (d == "right" || d == "up") ? 1 : -1;
}

bool wantsX() {
  String a = server.arg("axis");
  return a != "y";
}

bool wantsY() {
  String a = server.arg("axis");
  return a == "y" || a == "both";
}

// Il verso arriva come argomento perche' questo impulso non passa da
// startMoveSteps(), quindi deve aggiornare la posizione da solo. Si chiama solo
// a motori fermi (handleMotorStep verifica), quindi l'ISR non sta contando.
void pulseStepOnce(Motor& m, int d) {
  digitalWrite(m.stepPin, HIGH);
  delayMicroseconds(STEP_PULSE_US);
  digitalWrite(m.stepPin, LOW);
  m.posSteps += (d > 0) ? 1 : -1;
}

// Muovere con i driver liberi non ha senso, e due di questi comandi farebbero
// danno: l'impulso singolo incrementerebbe il contatore mentre il driver ignora
// lo STEP, e un movimento continuo resterebbe in coda nell'ISR per poi partire
// da solo appena i driver tornano attivi.
bool driverLiberi() {
  if (driverEnabled) return false;
  server.send(409, "text/plain",
              "motori liberi: riattivali, o premi «Homing completato», prima di muovere");
  return true;
}

// Un click = un microstep. A 1/16 sono 0,029 mm: non si vede muovere niente,
// ed è voluto — è la risoluzione della macchina, e serve per misurare il gioco.
void handleMotorStep() {
  if (driverLiberi()) return;
  int d = dirFromArg();
  if (motorX.stepsRemaining != 0 || motorY.stepsRemaining != 0) {
    server.send(409, "text/plain", "movimento in corso");
    return;
  }
  if (wantsX()) { setDir(motorX, d); pulseStepOnce(motorX, d); }
  if (wantsY()) { setDir(motorY, d); pulseStepOnce(motorY, d); }
  server.send(200, "text/plain", "ok");
}

void handleMotorStart() {
  if (driverLiberi()) return;
  int d = dirFromArg();
  demoStop("interrotta da un comando manuale");
  logMsg("Motore " + server.arg("axis") + ": avvio continuo verso " + (d > 0 ? "+" : "-"));
  if (wantsX()) startMove(motorX, d, -1);
  if (wantsY()) startMove(motorY, d, -1);
  server.send(200, "text/plain", "ok");
}

void handleMotorStop() {
  demoStop("interrotta dallo STOP");
  if (wantsX()) stopMotor(motorX);
  if (wantsY()) stopMotor(motorY);
  logMsg("Motori: stop (X " + String((long)motorX.stepsDone) + " passi, Y " + String((long)motorY.stepsDone) + " passi)");
  server.send(200, "text/plain", "ok");
}

void handleMotorFull() {
  if (driverLiberi()) return;
  int d = dirFromArg();
  demoStop("interrotta da un comando manuale");
  logMsg("Motore " + server.arg("axis") + ": un giro di pignone (" + String(stepsPerRev()) +
         " passi = " + String(wantsY() && !wantsX() ? motorY.mmPerRev : motorX.mmPerRev, 2) +
         " mm) verso " + (d > 0 ? "+" : "-"));
  if (wantsX()) startMove(motorX, d, stepsPerRev());
  if (wantsY()) startMove(motorY, d, stepsPerRev());
  server.send(200, "text/plain", "ok");
}

void handleMotorRun() {
  if (driverLiberi()) return;
  int d = dirFromArg();
  float mm = server.arg("mm").toFloat();
  if (mm < 0.01f) mm = 0.01f;
  if (mm > 400.0f) mm = 400.0f;

  demoStop("interrotta da un comando manuale");
  // Un conteggio di passi per asse: con due mmPerRev diversi, gli stessi
  // millimetri su X e su Y non sono lo stesso numero di passi.
  if (wantsX()) {
    long steps = lroundf(mm * stepsPerMm(motorX));
    if (steps < 1) steps = 1;
    logMsg("Test X: " + String(mm, 2) + " mm = " + String(steps) + " passi verso " +
           (d > 0 ? "+" : "-"));
    startMove(motorX, d, steps);
  }
  if (wantsY()) {
    long steps = lroundf(mm * stepsPerMm(motorY));
    if (steps < 1) steps = 1;
    logMsg("Test Y: " + String(mm, 2) + " mm = " + String(steps) + " passi verso " +
           (d > 0 ? "+" : "-"));
    startMove(motorY, d, steps);
  }
  server.send(200, "text/plain", "ok");
}

void handleMotorConfig() {
  float feed = server.arg("feed").toFloat();
  float ramp = server.arg("ramp").toFloat();
  if (feed < FEED_MIN_MM_S) feed = FEED_MIN_MM_S;
  if (feed > FEED_MAX_MM_S) feed = FEED_MAX_MM_S;
  if (ramp < RAMP_MIN_MM) ramp = RAMP_MIN_MM;
  if (ramp > RAMP_MAX_MM) ramp = RAMP_MAX_MM;

  bool isY = (server.arg("axis") == "y");
  Motor& m = isY ? motorY : motorX;
  m.feedMmS = feed;
  m.rampMm = ramp;
  motorPrefs.putFloat(isY ? "feedY" : "feedX", feed);
  motorPrefs.putFloat(isY ? "rampY" : "rampX", ramp);
  logMsg("Motore " + String(m.name) + ": " + String(feed, 1) + " mm/s (" +
         String((long)(feed * stepsPerMm(m))) + " passi/s), rampa " + String(ramp, 1) + " mm");
  server.send(200, "text/plain", "ok");
}

// Il numero di microstep non cambia nessun pin (a meno che MS_PIN sia definito):
// descrive al firmware com'è cablato il driver, e da lì discendono passi/mm,
// il giro completo e la conversione delle velocità.
void handleMotorMicro() {
  int n = server.arg("n").toInt();
  if (n != 1 && n != 2 && n != 4 && n != 8 && n != 16 && n != 32) {
    server.send(400, "text/plain", "microstep non valido");
    return;
  }
  stopMotor(motorX);
  stopMotor(motorY);
  demoStop("interrotta dal cambio microstep");
  microsteps = n;
  motorPrefs.putInt("micro", microsteps);
#if MS_PIN >= 0
  digitalWrite(MS_PIN, (microsteps > 1) ? HIGH : LOW);
#endif
  logMsg("Microstep: 1/" + String(microsteps) + " -> X " + String(stepsPerMm(motorX), 3) +
         " passi/mm, Y " + String(stepsPerMm(motorY), 3) +
         " passi/mm, un giro = " + String(stepsPerRev()) + " passi");
  server.send(200, "text/plain", "ok");
}

// --------------------------------------------------------------------------
// Azzeramento della posizione e taratura del rapporto, per asse
// --------------------------------------------------------------------------

// Azzera il contatore di posizione. Non muove niente e non tocca la macchina:
// dice solo "da qui conto da zero", che e' il gesto con cui si misura una corsa.
void handleMotorZero() {
  // Azzerare con i motori liberi darebbe un'origine che il primo urto sposta
  // senza dirlo: finche' l'asse non e' trattenuto, "zero" non vuol dire niente.
  if (!driverEnabled) {
    server.send(409, "text/plain",
                "motori liberi: usa «Homing completato», che prima li riattiva e poi azzera");
    return;
  }
  if (wantsX()) zeroPos(motorX);
  if (wantsY()) zeroPos(motorY);
  logMsg("Posizione azzerata (" + server.arg("axis") + ")");
  server.send(200, "text/plain", "ok");
}

// Taratura del rapporto di trasmissione, un asse per volta.
//
// Si comanda un movimento lungo e tondo, si misura col calibro quanto si e'
// spostato davvero, e si danno i due numeri a questa rotta. Il conto:
//
//   passi inviati     = comandato * 3200 / mmPerRev_vecchio
//   passi/mm veri     = passi inviati / misurato
//   mmPerRev_nuovo    = 3200 / passi/mm veri
//                     = mmPerRev_vecchio * misurato / comandato
//
// Il movimento va fatto LUNGO: su 200 mm un decimo di errore di lettura del
// calibro vale lo 0,05%, su 20 mm vale lo 0,5%. E va fatto in UN SENSO SOLO,
// senza tornare indietro, altrimenti ci si mette dentro anche il gioco.
void handleMotorCalib() {
  float cmd = server.arg("cmd").toFloat();
  float meas = server.arg("meas").toFloat();
  if (cmd < 10.0f || meas < 1.0f) {
    server.send(400, "text/plain", "comandato almeno 10 mm, misurato almeno 1 mm");
    return;
  }
  bool isY = (server.arg("axis") == "y");
  Motor& m = isY ? motorY : motorX;

  float before = m.mmPerRev;
  float after = before * meas / cmd;
  if (after < MM_PER_REV_MIN || after > MM_PER_REV_MAX) {
    logMsg("Taratura " + String(m.name) + " RIFIUTATA: " + String(after, 4) +
           " mm/giro e' fuori dalla forchetta " + String(MM_PER_REV_MIN, 0) + "-" +
           String(MM_PER_REV_MAX, 0) + ". Controlla i due numeri.");
    server.send(400, "text/plain", "risultato fuori scala");
    return;
  }

  m.mmPerRev = after;
  motorPrefs.putFloat(isY ? "mmRevY" : "mmRevX", after);
  logMsg("Taratura " + String(m.name) + ": comandati " + String(cmd, 2) + " mm, misurati " +
         String(meas, 2) + " -> " + String(after, 4) + " mm/giro (era " + String(before, 4) +
         "), " + String(stepsPerMm(m), 4) + " passi/mm. Scarto " +
         String((after / MM_PER_REV - 1.0f) * 100.0f, 2) + "% dal nominale.");
  // La posizione contava in passi con il rapporto vecchio: in millimetri ora
  // vuol dire un'altra cosa, quindi si azzera invece di mentire.
  zeroPos(m);
  server.send(200, "text/plain", "ok");
}

// Scrive il rapporto a mano, o lo riporta al nominale con v=0.
void handleMotorMmRev() {
  float v = server.arg("v").toFloat();
  if (v == 0.0f) v = MM_PER_REV;
  if (v < MM_PER_REV_MIN || v > MM_PER_REV_MAX) {
    server.send(400, "text/plain", "fuori scala");
    return;
  }
  bool isY = (server.arg("axis") == "y");
  Motor& m = isY ? motorY : motorX;
  m.mmPerRev = v;
  motorPrefs.putFloat(isY ? "mmRevY" : "mmRevX", v);
  zeroPos(m);
  logMsg("Rapporto " + String(m.name) + " impostato a " + String(v, 4) + " mm/giro -> " +
         String(stepsPerMm(m), 4) + " passi/mm");
  server.send(200, "text/plain", "ok");
}

void handlePenSet() {
  String st = server.arg("state");
  if (st == "toggle") st = (penState == "down") ? "up" : "down";
  if (st != "up" && st != "down" && st != "free") {
    server.send(400, "text/plain", "stato sconosciuto");
    return;
  }
  setPen(st);
  server.send(200, "text/plain", "ok");
}

// Angolo libero dallo slider: muove il servo e basta, non tocca i due valori
// salvati di penna alzata e abbassata.
void handlePenAngle() {
  int deg = server.arg("deg").toInt();
  servoGoTo(deg);
  penState = "man";
  server.send(200, "text/plain", "ok");
}

void handlePenInvert() {
  penInvert = (server.arg("on") == "1");
  motorPrefs.putBool("invPen", penInvert);
  logMsg(String("Servo penna: verso ") + (penInvert ? "invertito" : "normale") +
         " (piu gradi = penna piu in alto)");
  // Riapplica subito, cosi il verso nuovo si vede senza toccare altro.
  if (servoAttached) servoApply(servoCurrentDeg);
  server.send(200, "text/plain", "ok");
}

void handlePenSlew() {
  int d = server.arg("deg").toInt();
  if (d < 0) d = 0;
  if (d > 20) d = 20;
  servoSlewDeg = d;
  motorPrefs.putInt("slew", servoSlewDeg);
  if (servoSlewDeg == 0) logMsg("Servo: rampa disattivata, movimento secco");
  else logMsg("Servo: rampa " + String(servoSlewDeg) + " gradi ogni " +
              String(SERVO_SLEW_MS) + " ms (" + String(1000 / (long)SERVO_SLEW_MS * servoSlewDeg) +
              " gradi/s)");
  server.send(200, "text/plain", "ok");
}

void handlePenConfig() {
  int up = server.arg("up").toInt();
  int down = server.arg("down").toInt();
  penUpDeg = constrain(up, 0, 180);
  penDownDeg = constrain(down, 0, 180);
  motorPrefs.putInt("penUp", penUpDeg);
  motorPrefs.putInt("penDn", penDownDeg);

  // Portarsi subito sull'angolo appena regolato, per poter tarare a vista.
  String preview = server.arg("preview");
  if (preview == "up" || preview == "down") setPen(preview);
  else logMsg("Penna: alzata " + String(penUpDeg) + " gradi, abbassata " + String(penDownDeg) + " gradi");

  server.send(200, "text/plain", "ok");
}

void handleDemoStart() {
  String what = server.arg("what");
  int kind = (what == "circle") ? DEMO_CIRCLE : (what == "square") ? DEMO_SQUARE : DEMO_NONE;
  if (kind == DEMO_NONE) {
    server.send(400, "text/plain", "prova sconosciuta");
    return;
  }
  if (driverLiberi()) return;
  stopMotor(motorX);
  stopMotor(motorY);
  demoStart(kind);
  server.send(200, "text/plain", "ok");
}

void handleDemoStop() {
  demoStop("interrotta dall'utente");
  stopMotor(motorX);
  stopMotor(motorY);
  server.send(200, "text/plain", "ok");
}

void handleMotorInvert() {
  bool isY = (server.arg("axis") == "y");
  Motor& m = isY ? motorY : motorX;
  m.invert = (server.arg("on") == "1");
  stopMotor(m); // il verso non va cambiato a movimento in corso
  motorPrefs.putBool(isY ? "invY" : "invX", m.invert);
  logMsg("Motore " + String(m.name) + ": direzione " + (m.invert ? "invertita" : "normale"));
  server.send(200, "text/plain", "ok");
}

// Abilita o libera i due driver tenendo conto di quello che la liberazione
// comporta davvero. Non e' la stessa cosa di setDriverEnabled(), che muove solo
// il pin: qui si ferma anche un movimento in corso — altrimenti resterebbe in
// coda e ripartirebbe da solo alla riabilitazione — e si dichiara persa la
// posizione dei due assi.
void setMotorsEnabled(bool on) {
  if (!on) {
    stopMotor(motorX);
    stopMotor(motorY);
    motorX.posNota = false;
    motorY.posNota = false;
  }
  setDriverEnabled(on);
}

void handleMotorEnable() {
  bool on = (server.arg("on") == "1");
  setMotorsEnabled(on);
  logMsg(String("Driver A4988: ") + (on ? "abilitati (ENABLE basso)"
                                        : "disabilitati (ENABLE alto) — posizione non piu' nota"));
  server.send(200, "text/plain", "ok");
}

// --------------------------------------------------------------------------
// Homing a mano
// --------------------------------------------------------------------------
// Non c'e' nessun finecorsa: il riferimento sono i blocchi stampati agganciati
// alle staffe TT e LL, e i carrelli ci si appoggiano A MANO. Spingerli col
// motore non sarebbe solo lento: la coppia di uno stepper basta a spostare il
// blocco, cioe' a spostare proprio la cosa che definisce la misura. A mano si
// appoggia e basta, senza forzare.
//
// Due gesti, e l'ordine conta: riattivare PRIMA e azzerare POI. Al contrario,
// l'origine resterebbe alla merce' del primo urto senza che nessuno lo dica.
void handleHomingFree() {
  demoStop("interrotta per l'homing");
  setMotorsEnabled(false);
  logMsg("Homing: motori liberi, posizione non piu' nota. Appoggia i carrelli ai blocchi.");
  server.send(200, "text/plain", "ok");
}

void handleHomingDone() {
  setMotorsEnabled(true);
  zeroPos(motorX);
  zeroPos(motorY);
  logMsg("Homing completato: motori riattivati, posizione azzerata su entrambi gli assi.");
  server.send(200, "text/plain", "ok");
}

// Forza un singolo pin a un livello fisso, per poterlo misurare col multimetro
// direttamente sul pin del driver. Qualsiasi movimento in corso viene fermato.
void handlePinSet() {
  String pin = server.arg("pin");
  bool high = (server.arg("level") == "1");
  demoStop("interrotta dal test pin");
  stopMotor(motorX);
  stopMotor(motorY);

  if (pin == "stepx") {
    digitalWrite(STEP_X_PIN, high ? HIGH : LOW);
  } else if (pin == "dirx") {
    digitalWrite(DIR_X_PIN, high ? HIGH : LOW);
  } else if (pin == "stepy") {
    digitalWrite(STEP_Y_PIN, high ? HIGH : LOW);
  } else if (pin == "diry") {
    digitalWrite(DIR_Y_PIN, high ? HIGH : LOW);
  } else if (pin == "en") {
    setMotorsEnabled(!high); // ENABLE attivo basso: livello alto = driver disabilitati
  } else {
    server.send(400, "text/plain", "pin sconosciuto");
    return;
  }

  logMsg("Test pin: " + pin + " forzato a " + (high ? "3.3 V (alto)" : "0 V (basso)"));
  server.send(200, "text/plain", "ok");
}

void handleWifiSave() {
  String ssid = server.arg("ssid");
  String password = server.arg("password");
  if (ssid.length() == 0) {
    server.send(400, "text/plain", "SSID richiesto.");
    return;
  }
  prefs.putString("ssid", ssid);
  prefs.putString("pass", password);
  server.send(200, "text/plain", "Credenziali salvate.");
  delay(500);
  ESP.restart();
}

void handleNotFound() {
  server.send(404, "text/plain", "Non trovato");
}

bool connectToWifi(const String& ssid, const String& password) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

void startSetupAP() {
  apMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
}

void setupOTA() {
  ArduinoOTA.setHostname("cnc2d");
  ArduinoOTA.setPassword(AP_PASS);
  ArduinoOTA.onStart([]() {
    demoStop("interrotta dall'aggiornamento OTA");
    stopMotor(motorX); // niente passi durante un aggiornamento firmware
    stopMotor(motorY);
    logMsg("OTA: aggiornamento avviato...");
  });
  ArduinoOTA.onEnd([]() {
    logMsg("OTA: completato, riavvio.");
  });
  ArduinoOTA.onError([](ota_error_t error) {
    logMsg("OTA errore [" + String((int)error) + "]");
  });
  ArduinoOTA.begin();
}

void setupStepTimer() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  stepTimer = timerBegin(1000000); // base dei tempi a 1 MHz
  timerAttachInterrupt(stepTimer, &onStepTick);
  timerAlarm(stepTimer, 1000000 / TICK_HZ, true, 0);
#else
  stepTimer = timerBegin(0, 80, true); // 80 MHz / 80 = 1 MHz
  timerAttachInterrupt(stepTimer, &onStepTick, true);
  timerAlarmWrite(stepTimer, 1000000 / TICK_HZ, true);
  timerAlarmEnable(stepTimer);
#endif
}

void setup() {
  Serial.begin(115200);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(YELLOW_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(YELLOW_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);

  // I pin STEP vanno portati a livello basso il prima possibile: finché restano
  // ingressi flottanti raccolgono rumore e il driver lo interpreta come passi.
  pinMode(STEP_X_PIN, OUTPUT);
  pinMode(STEP_Y_PIN, OUTPUT);
  digitalWrite(STEP_X_PIN, LOW);
  digitalWrite(STEP_Y_PIN, LOW);
  pinMode(DIR_X_PIN, OUTPUT);
  pinMode(DIR_Y_PIN, OUTPUT);
  digitalWrite(DIR_X_PIN, LOW);
  digitalWrite(DIR_Y_PIN, LOW);
  pinMode(ENABLE_PIN, OUTPUT);
  setDriverEnabled(true);

  motorPrefs.begin("motor_cfg", false);
  motorX.invert = motorPrefs.getBool("invX", false);
  motorY.invert = motorPrefs.getBool("invY", false);
  motorX.feedMmS = motorPrefs.getFloat("feedX", 20.0f);
  motorY.feedMmS = motorPrefs.getFloat("feedY", 20.0f);
  motorX.rampMm = motorPrefs.getFloat("rampX", 3.0f);
  motorY.rampMm = motorPrefs.getFloat("rampY", 3.0f);
  motorX.mmPerRev = motorPrefs.getFloat("mmRevX", MM_PER_REV);
  motorY.mmPerRev = motorPrefs.getFloat("mmRevY", MM_PER_REV);
  microsteps = motorPrefs.getInt("micro", 16);
  penUpDeg = motorPrefs.getInt("penUp", 90);
  penDownDeg = motorPrefs.getInt("penDn", 60);
  servoSlewDeg = motorPrefs.getInt("slew", 2);
  penInvert = motorPrefs.getBool("invPen", true);
  penAngle = penUpDeg;
  servoCurrentDeg = penUpDeg;
  servoTargetDeg = penUpDeg;

#if MS_PIN >= 0
  pinMode(MS_PIN, OUTPUT);
  digitalWrite(MS_PIN, (microsteps > 1) ? HIGH : LOW);
#endif

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SERVO_PIN, SERVO_FREQ, SERVO_RES_BITS);
#else
  ledcSetup(SERVO_CHANNEL, SERVO_FREQ, SERVO_RES_BITS);
  ledcAttachPin(SERVO_PIN, SERVO_CHANNEL);
#endif
  servoRelease();

  setupStepTimer();
  logMsg("Trasmissione, microstep 1/" + String(microsteps) +
         ": X " + String(motorX.mmPerRev, 4) + " mm/giro = " + String(stepsPerMm(motorX), 3) +
         " passi/mm, Y " + String(motorY.mmPerRev, 4) + " mm/giro = " +
         String(stepsPerMm(motorY), 3) + " passi/mm (nominale " + String(MM_PER_REV, 4) + ")");

  prefs.begin("wifi_cfg", false);
  String savedSsid = prefs.getString("ssid", "");
  String savedPass = prefs.getString("pass", "");

  if (savedSsid.length() > 0 && connectToWifi(savedSsid, savedPass)) {
    apMode = false;
    logMsg("Connesso. IP: " + WiFi.localIP().toString());
    setupOTA();
    logMsg("mDNS/OTA attivi: http://cnc2d.local");
  } else {
    logMsg("Connessione Wi-Fi fallita o non configurata. Avvio modalita' configurazione.");
    startSetupAP();
    logMsg("Connettiti alla rete '" + String(AP_SSID) + "' e apri http://" + WiFi.softAPIP().toString());
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/led/red/toggle", HTTP_GET, handleLedRedToggle);
  server.on("/api/led/yellow/toggle", HTTP_GET, handleLedYellowToggle);
  server.on("/api/led/green/toggle", HTTP_GET, handleLedGreenToggle);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/log", HTTP_GET, handleLog);
  server.on("/api/motor/step", HTTP_GET, handleMotorStep);
  server.on("/api/motor/start", HTTP_GET, handleMotorStart);
  server.on("/api/motor/stop", HTTP_GET, handleMotorStop);
  server.on("/api/motor/full", HTTP_GET, handleMotorFull);
  server.on("/api/motor/run", HTTP_GET, handleMotorRun);
  server.on("/api/motor/config", HTTP_GET, handleMotorConfig);
  server.on("/api/motor/micro", HTTP_GET, handleMotorMicro);
  server.on("/api/motor/zero", HTTP_GET, handleMotorZero);
  server.on("/api/motor/calib", HTTP_GET, handleMotorCalib);
  server.on("/api/motor/mmrev", HTTP_GET, handleMotorMmRev);
  server.on("/api/pen/set", HTTP_GET, handlePenSet);
  server.on("/api/pen/angle", HTTP_GET, handlePenAngle);
  server.on("/api/pen/config", HTTP_GET, handlePenConfig);
  server.on("/api/pen/slew", HTTP_GET, handlePenSlew);
  server.on("/api/pen/invert", HTTP_GET, handlePenInvert);
  server.on("/api/demo/start", HTTP_GET, handleDemoStart);
  server.on("/api/demo/stop", HTTP_GET, handleDemoStop);
  server.on("/api/motor/invert", HTTP_GET, handleMotorInvert);
  server.on("/api/motor/enable", HTTP_GET, handleMotorEnable);
  server.on("/api/homing/free", HTTP_GET, handleHomingFree);
  server.on("/api/homing/done", HTTP_GET, handleHomingDone);
  server.on("/api/pin/set", HTTP_GET, handlePinSet);
  server.on("/api/wifi/save", HTTP_POST, handleWifiSave);
  server.onNotFound(handleNotFound);
  server.begin();
}

void loop() {
  // I passi ora li emette il timer hardware, quindi qui resta solo quello che
  // può permettersi di aspettare: il web, l'OTA e l'avanzamento della prova
  // d'insieme da un tratto al successivo.
  server.handleClient();
  ArduinoOTA.handle();
  serviceServo();
  serviceDemo();
}
