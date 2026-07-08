// ESP8266 serial entropy streamer — COMPAT-ONLY tier.
// The RANDOM_REG32 register (0x3FF20E44) is UNDOCUMENTED by Espressif; its
// true entropy content is unverifiable. If you are buying hardware, buy an
// ESP32 (documented TRNG) instead — this sketch exists for boards you
// already own. XOR-folding two reads is cheap decorrelation, not a fix.
#include <esp8266_peri.h>

void setup() {
  Serial.begin(921600);
}

void loop() {
  uint32_t buffer[64];
  for (int i = 0; i < 64; i++) {
    uint32_t a = RANDOM_REG32;
    uint32_t b = RANDOM_REG32;
    buffer[i] = a ^ ((b << 16) | (b >> 16));
  }
  Serial.write((uint8_t*)buffer, sizeof(buffer));
  yield();
}
