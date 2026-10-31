#pragma once
#include "Arduino.h"
#define FILE_WRITE 1
struct File {
  operator bool() const;
  void print(const char*); void print(int); void print(char);
  void println(int);
  void close();
};
struct SDFinta { bool begin(int); File open(const char*, int); };
extern SDFinta SD;
