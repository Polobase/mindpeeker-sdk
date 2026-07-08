// Arduino Uno/Nano + avalanche-noise circuit → A0 (keep the divider under 5 V!)
// Circuit: Rob Seward RNG v2 lineage — 2× 2N3904 reverse-biased B–E junction
// pair + 1× 2N3904 amplifier at 12–15 V (see firmware/README.md for the BOM).
// Raw comparator bits are biased and drift; this sketch calibrates a
// threshold at boot and applies von Neumann debiasing in-firmware.
// Rate: ~100–250 bytes/s. Serial: 115200 (AVR UART limit) — pass
// { baudRate: 115200 } to nodeSerialSource.
// ⚠️ Avalanche behaviour degrades as the transistor ages: recalibrate
// (reset) regularly and treat this as an educational/demo source.
const int PIN = A0;
unsigned threshold = 512;

void calibrate() { // ~1 s mean calibration
  unsigned long sum = 0;
  for (int i = 0; i < 5000; i++) {
    sum += analogRead(PIN);
    delayMicroseconds(100);
  }
  threshold = sum / 5000;
}

inline int rndBit() { return analogRead(PIN) > threshold ? 1 : 0; }

void setup() {
  Serial.begin(115200);
  calibrate();
}

void loop() {
  uint8_t out = 0;
  for (int i = 0; i < 8; i++) {
    int a, b;
    do {
      a = rndBit();
      b = rndBit();
    } while (a == b); // von Neumann: keep only 01/10 pairs
    out = (out << 1) | a;
  }
  Serial.write(out);
}
