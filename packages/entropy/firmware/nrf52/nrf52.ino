// nRF52832/nRF52840 serial entropy streamer.
// Entropy: Nordic's thermal-noise RNG with hardware bias correction enabled.
// Rate: ~0.4–13 KB/s with correction on (byte timing is inherently variable).
// Core: Adafruit nRF52. NOTE: with a SoftDevice active, use
// sd_rand_application_vector_get instead of direct register access.

void setup() {
  Serial.begin(921600); // ignored for native USB CDC
  NRF_RNG->CONFIG = RNG_CONFIG_DERCEN_Msk; // bias correction on
  NRF_RNG->TASKS_START = 1;
}

void loop() {
  while (!NRF_RNG->EVENTS_VALRDY) {}
  NRF_RNG->EVENTS_VALRDY = 0;
  Serial.write((uint8_t)NRF_RNG->VALUE);
}
