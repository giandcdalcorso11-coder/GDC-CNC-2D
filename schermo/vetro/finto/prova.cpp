#include "telecomando_copia.ino"
unsigned long millis() { return 0; }
void delay(unsigned long) {}
void pinMode(int,int) {} void digitalWrite(int,int) {} int digitalRead(int){return 0;}
void analogWrite(int,int) {} int analogRead(int){return 0;}
void tone(int,int) {} void noTone(int) {}
SerialeFinta Serial; SDFinta SD; WiFiFinta WiFi;
int main() { setup(); loop(); return 0; }
