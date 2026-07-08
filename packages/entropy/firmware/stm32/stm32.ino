// STM32 hardware-TRNG serial streamer — best quality on the list:
// analog ring-oscillator noise, FIPS 140-2 / AIS-31 / SP 800-90B-aligned,
// independently validated with dieharder/PractRand over 100s of GB.
//
// ⚠️ BOARD CHECK: F401/F411 ("Black Pill") and F446 have NO RNG peripheral.
//    Use F405/F407 boards (WeAct F405 core board, F407VET6/VGT6, DISC1) or
//    any F2/F7/L4/L5/G4/H7/WB part with the RNG block.
//
// Core: STM32duino (Arduino_Core_STM32).
//   Tools → USB support: "CDC (generic 'Serial' supersede U(S)ART)"
//   Build flag: -DHAL_RNG_MODULE_ENABLED (PlatformIO build_flags, or
//   hal_conf_extra.h in the Arduino IDE).
RNG_HandleTypeDef hrng;

void setup() {
  Serial.begin(921600); // ignored for native USB CDC
  __HAL_RCC_RNG_CLK_ENABLE();
  hrng.Instance = RNG;
  HAL_RNG_Init(&hrng);
}

void loop() {
  uint32_t words[64]; // 256-byte blocks
  for (int i = 0; i < 64; ) {
    // HAL runs the FIPS continuous check and re-seeds on CEIS/SEIS errors —
    // just retry until a word is accepted.
    if (HAL_RNG_GenerateRandomNumber(&hrng, &words[i]) == HAL_OK) i++;
  }
  Serial.write((uint8_t*)words, sizeof(words));
}
