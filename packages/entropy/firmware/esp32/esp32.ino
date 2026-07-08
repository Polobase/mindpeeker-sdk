// ESP32 TRNG serial streamer — the AetherOnePi reference firmware.
// Entropy: SAR-ADC noise via bootloader_random_enable() feeding esp_fill_random.
// Board: any ESP32 (Arduino IDE: "ESP32 Dev Module"). Serial: 921600 8N1.
#include "esp_system.h"
#include "esp_random.h"
#include "bootloader_random.h"

void setup() {
  Serial.begin(921600);
  delay(1000);
  // Keep the physical entropy source running — without this (or WiFi/BT on),
  // esp_random silently degrades to pseudo-random after boot.
  bootloader_random_enable();
}

void loop() {
  uint8_t buffer[256];
  esp_fill_random(buffer, sizeof(buffer));
  Serial.write(buffer, sizeof(buffer));
}
