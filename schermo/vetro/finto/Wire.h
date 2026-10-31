/* IL BUS FINTO.
   Dentro ci sta un apparecchio solo: il caricabatterie del MKR, e di
   quello un registro solo — lo stato. Lo decide la prova (`vetro.cpp`)
   prima di chiedere una schermata, così si può guardare il fulmine
   senza avere una spina. */
#pragma once
#include "Arduino.h"
#define HEX 16
extern uint8_t PMIC_STATO_FINTO;
struct WireFinto {
  void begin();
  void beginTransmission(uint8_t);
  void write(uint8_t);
  uint8_t endTransmission(bool stop = true);
  uint8_t requestFrom(uint8_t, uint8_t);
  int available();
  uint8_t read();
};
extern WireFinto Wire;
