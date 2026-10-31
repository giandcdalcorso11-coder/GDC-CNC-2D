#pragma once
#include "Arduino.h"
#define TFT_BACKLIGHT 3
typedef enum { TOUCH0 = 0, TOUCH1, TOUCH2, TOUCH3, TOUCH4 } touchButtons;
struct Gfx {
  void init(int,int); void setRotation(int); void fillScreen(uint16_t);
  void drawPixel(int,int,uint16_t);
  void drawLine(int,int,int,int,uint16_t);
  void drawFastHLine(int,int,int,uint16_t);
  void drawRect(int,int,int,int,uint16_t);
  void fillRect(int,int,int,int,uint16_t);
  void drawRoundRect(int,int,int,int,int,uint16_t);
  void drawCircle(int,int,int,uint16_t);
  void fillCircle(int,int,int,uint16_t);
  void drawCircleHelper(int,int,int,uint8_t,uint16_t);
  void drawTriangle(int,int,int,int,int,int,uint16_t);
  void fillTriangle(int,int,int,int,int,int,uint16_t);
  void setTextSize(int); void setTextColor(uint16_t); void setCursor(int,int);
  void print(const char*);
};
struct Leds { void setPixelColor(int,int,int,int); void show(); };
struct Qtouch {
  bool update(); bool getTouch(touchButtons); bool onTouchDown(touchButtons);
  bool onTouchUp(touchButtons);
};
struct Buz { void sound(int); void noSound(); void beep(int,unsigned long); };
struct MKRIoTCarrier {
  int begin(); void noCase(); void withCase();
  Gfx display; Leds leds; Qtouch Buttons; Buz Buzzer;
};
