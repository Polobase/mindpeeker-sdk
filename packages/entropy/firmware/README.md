# TRNG firmware collection

Ready-to-flash sketches that turn cheap microcontrollers into serial entropy sources for
`serialEntropy`. Every sketch speaks the same contract (the AetherOnePi pattern): **a
continuous, unframed stream of raw random bytes over USB serial** — no handshake, no protocol.

```ts
import { serialEntropy } from '@mindpeeker/entropy/providers'
import { nodeSerialSource } from '@mindpeeker/entropy/node'

const board = serialEntropy({
  source: await nodeSerialSource({ path: '/dev/cu.usbserial-110', baudRate: 921_600 }),
  name: 'esp32', // any label you like — shows up in attribution
})
```

In Chromium/Firefox browsers the same provider works over Web Serial:
`serialEntropy({ port: await navigator.serial.requestPort() })`.

## Which board? (verified July 2026)

| Board | RNG hardware | Assurance | Rate (serial-limited) | Price | Verdict |
|---|---|---|---|---|---|
| **Raspberry Pi Pico 2 (RP2350)** | dedicated TRNG peripheral (ring-oscillator noise → 192-bit entropy register) | good — real hardware TRNG | ~200–400 KB/s (USB CDC) | **$5** | ⭐ best value |
| **STM32F405/F407 board** | analog ring-oscillator TRNG, FIPS 140-2/AIS-31/SP 800-90B-aligned; passed dieharder + PractRand over 100s of GB | best on this list | saturates the link | $10–15 | ⭐ best quality |
| ESP32 (AetherOnePi reference) | `esp_fill_random` w/ `bootloader_random_enable()` (SAR-ADC noise) | good (measured 7.07 b/B raw) | ~92 KB/s @921600 | $5–10 | the proven default |
| nRF52840 (dongle/XIAO) | thermal-noise RNG with hardware bias correction | good | ~1–30 KB/s | ~$10 | good, slow |
| Raspberry Pi Pico (RP2040) | ROSC `RANDOMBIT` — datasheet says **not security-grade**; `pico_rand` mixes it through a PRNG | low — label it conditioned/PRNG-mixed | ~200–400 KB/s (mostly PRNG expansion) | $4 | fine for play, prefer Pico 2 |
| Arduino + avalanche circuit | 2N3904 avalanche noise (DIY analog) | educational — visibly physical; needs whitening; transistors age | ~0.1–0.25 KB/s | $5–10 total | the fun one |
| Teensy 4.x | i.MX RT1062 TRNG (thinly documented) | ok | ~0.5–10 KB/s | $24–32 | works, poor value |
| ESP8266 | **undocumented** register `0x3FF20E44` | unverifiable | ~92 KB/s | $2–5 | compat-only — use ESP32 instead |

> **⚠️ STM32 trap:** the ubiquitous F401/F411 "Black Pill" boards and the F446 have **NO RNG
> peripheral** (verified against ST's CMSIS device headers). Buy F405/F407-based boards.

## AVR avalanche circuit (DIY tier)

Rob Seward-style: 3× 2N3904 (~$0.30), five resistors (4.7 kΩ–1 MΩ), two capacitors, and a
12–15 V source (two 9 V blocks, a $1 boost module, or a MAX232 charge pump to stay on the
5 V rail). The reverse-biased base–emitter junction avalanches; the third transistor
amplifies into `A0`. Schematics: robseward.com/misc/RNG2 (or the scruss.com 5 V variant).
Raw comparator bits are biased and drift with temperature — the sketch does von Neumann
in-firmware, and avalanche behaviour **degrades as the transistor ages**: recalibrate, and
treat it as a demonstration source.

## Notes

- These sketches ship as community-verified references — flash, then confirm quality with
  `bun run quality` (the library's health tests run on every byte regardless).
- None of this folder is published to npm; it lives in the repo as documentation.
