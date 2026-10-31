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
  void println(const char*); void println(int); void println(long); void println(float);
  void println();
  operator bool() const;
};
extern SerialeFinta Serial;
struct IPAddress { uint8_t v[4]; uint8_t operator[](int i) const { return v[i]; } };
