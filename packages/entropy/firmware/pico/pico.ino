// Raspberry Pi Pico / Pico 2 serial entropy streamer.
// Core: Arduino-Pico (earlephilhower). The same sketch runs on both boards:
//  - RP2350 (Pico 2): pico_rand is fed by the REAL hardware TRNG peripheral. ⭐
//  - RP2040 (Pico 1): pico_rand is a xoroshiro128** PRNG continuously
//    re-seeded from ROSC jitter — the datasheet calls the raw source NOT
//    security-grade, so label this board's output conditioned/low-assurance.
// Serial: native USB CDC (the baud rate is ignored).
#include "pico/rand.h"

void setup() {
  Serial.begin(921600);
}

void loop() {
  uint32_t buffer[64]; // 256-byte blocks, AetherOnePi-style
  for (int i = 0; i < 64; i++) buffer[i] = get_rand_32();
  Serial.write((const uint8_t*)buffer, sizeof(buffer));
}
