/* Finte intestazioni: servono solo a far passare il compilatore sulla
   SINTASSI e sui nomi. Non emulano niente. */
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <algorithm>
#define DEG_TO_RAD 0.017453292519943295
#define PI 3.1415926535897932
using std::min; using std::max; using std::abs;
typedef uint8_t byte;
unsigned long millis();
void delay(unsigned long);
void pinMode(int, int);
void digitalWrite(int, int);
int  digitalRead(int);
void analogWrite(int, int);
int  analogRead(int);

/* IL TIMER FINTO, e il clock della scheda. Non suona niente: serve a far
   compilare il codice del volume e, soprattutto, a controllare i DUE
   NUMERI che ci finiscono dentro - il periodo e la parte alta - che sulla
   scheda non si possono rileggere e a orecchio non si distinguono. Un
   volume che sbaglia il periodo cambierebbe la NOTA, non il volume, e
   nessuno se ne accorgerebbe ascoltando un cicalino. */
#define F_CPU 48000000L
struct TccReg { unsigned long reg; };
struct TccFinto { TccReg PER; TccReg SYNCBUSY; TccReg CC[8]; };
extern TccFinto* TCC0;
void tone(int, int);
void noTone(int);
#define OUTPUT 1
#define INPUT_PULLUP 2
#define HIGH 1
#define LOW 0
#define ADC_BATTERY 32
struct SerialeFinta {
  void begin(long);
  void print(const char*); void print(int); void print(long); void print(float); void print(char);
  /* Al banco nessuno scrive nel monitor: la finestra lunga non parte. */
  int available() { return 0; }
  int read() { return -1; }
  void println(const char*); void println(int); void println(long); void println(float);
  void println();
  /* Con la base: `Serial.print(v, HEX)` dei registri del caricabatterie. */
  void print(int, int); void println(int, int);
  operator bool() const;
};
extern SerialeFinta Serial;
struct IPAddress { uint8_t v[4]; uint8_t operator[](int i) const { return v[i]; } };
