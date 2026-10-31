#pragma once
#include "Arduino.h"
#define WL_CONNECTED 3
struct WiFiClient {
  operator bool() const;
  bool connected(); int available(); int read(); void stop();
  void print(const char*); void print(unsigned long);
  void println(const char*); void println(unsigned long); void println();
};
struct WiFiServer { WiFiServer(int); void begin(); WiFiClient available(); };
struct WiFiFinta { int status(); void begin(const char*, const char*); IPAddress localIP(); };
extern WiFiFinta WiFi;
