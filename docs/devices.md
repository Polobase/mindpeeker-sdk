# Devices

Which physical entropy sources work with `@mindpeeker/entropy`, through which provider, and
how far each combination has been tested. The provider API and the health-test pipeline are
documented in [`packages/entropy/README.md`](../packages/entropy/README.md); this page is the
hardware view.

Every local provider runs the same pipeline: raw samples, SP 800-90B start-up and continuous
health tests (Repetition Count and Adaptive Proportion), then SHA-256 conditioning with a
per-source min-entropy credit, or a health-tested raw passthrough with `conditioning: 'raw'`.
Health tests can only fail a source; passing them does not show that a device produces
unpredictable bytes. The credits below are the defaults in the provider source.

**Test status** used on this page:

- **hardware-tested**: run against the physical device by the maintainers;
- **documented protocol**: built from vendor or datasheet documentation and tested with
  injected byte sources, not run on the device;
- **community-verified**: reference code for devices the maintainers do not own;
- **unsupported**: no provider; the reason is given.

## Serial TRNG boards

These boards stream an unframed sequence of random bytes over USB serial (the AetherOnePi
pattern). Read them with `serialEntropy`: a Web Serial `port` in the browser, or
`nodeSerialSource({ path, baudRate })` from `@mindpeeker/entropy/node` in Node (macOS and
Linux, via `stty`). Default credit: 7 bits per byte. Sketches for all boards except Teensy
live in [`packages/entropy/firmware/`](../packages/entropy/firmware/) (repository only, not
published); the table follows that folder's README, which dates its board survey July 2026.

| Board | RNG hardware | Rate over USB serial | Status |
|---|---|---|---|
| ESP32 with the [AetherOnePi](https://github.com/isuretpolos/AetherOnePi) sketch | `esp_fill_random` with `bootloader_random_enable()` (SAR-ADC noise), 921 600 baud | ~69 KiB/s raw, ~31 KiB/s conditioned (entropy README benchmark) | hardware-tested; raw output measured 7.06 bits/byte (SP 800-90B most-common-value estimate) against the 7 bits/byte credit |
| Raspberry Pi Pico 2 (RP2350) | dedicated TRNG peripheral | ~200–400 KB/s | community-verified sketch |
| STM32F405 / F407 boards | analog TRNG peripheral | limited by the link | community-verified sketch. The F401, F411 ("Black Pill") and F446 have **no** RNG peripheral |
| nRF52840 | thermal-noise RNG with bias correction | ~1–30 KB/s | community-verified sketch |
| Raspberry Pi Pico (RP2040) | ring-oscillator bit, **not security-grade** per its datasheet; the Pico SDK's `pico_rand` feeds it into a xoroshiro128** PRNG | ~200–400 KB/s, mostly PRNG expansion | community-verified sketch (the same sketch as the Pico 2); label the output PRNG-mixed |
| Arduino + avalanche-diode circuit | 2N3904 avalanche noise, von Neumann in firmware | ~0.1–0.25 KB/s | community-verified DIY sketch; drifts with temperature and transistor ageing |
| Teensy 4.x | i.MX RT1062 TRNG (thinly documented) | ~0.5–10 KB/s | no sketch; listed for comparison |
| ESP8266 | undocumented register | ~92 KB/s | compatibility only; its randomness cannot be verified |

A raw ESP32 stream at ~69 KiB/s reaches its third false health alarm after about 12 minutes on
average (the default `maxHealthFailures` is 3; the entropy README gives the false-alarm rate per
MiB). Long unattended sessions should raise `maxHealthFailures` or reopen the source on
`health_test`; the visualizer demo reopens hardware sources after a health failure.

## USB hardware RNGs

| Device | How | Status |
|---|---|---|
| TrueRNG v3 | `serialEntropy`: a plain CDC byte stream, like the ESP32 | documented protocol |
| TrueRNGpro / TrueRNGpro V2 | `truerng({ port, mode })` preset (Web Serial). Modes are chosen by a baud-rate knock 110 → 300 → 110 followed by the mode's rate, and the device streams while DTR is set ([ubld.it](https://ubld.it/products/about/how-to-change-truerngpros-mode/)). Byte-stream modes: `normal` (300 baud, both generators whitened), `rng1` (4800), `rng2` (9600). `TRUERNG_MODES` also lists `psuDebug` (1200), `rngDebug` (2400), `rawBinary` (19 200, 4-byte packets) and `rawAscii` (38 400); these need a parser the SDK does not ship, so `truerng` rejects them. The unwhitened 57 600-baud mode mentioned in secondary sources is not in the vendor mode table and is not offered | documented protocol; not run on a device. The knock over Web Serial close/reopen and DTR through `setSignals` are unverified |
| OneRNG | `onerng({ port, mode })` preset (Web Serial). The entropy feed is **off at power-up**; the preset writes the mode command, `cmdw` (flush) and `cmdO` (feed on) after opening and `cmdo` (feed off) before closing ([Moonbase Otago](http://moonbaseotago.com/onerng/theory.html)). Modes: `avalanche` `cmd0`, `avalancheRaw` `cmd1`, `avalancheRf` `cmd2`, `avalancheRfRaw` `cmd3`, `rf` `cmd6`, `rfRaw` `cmd7`. Raw modes are credited 4 bits/byte by default. On a host tty, turn local echo off first, or the device can read its own output back as commands | documented protocol; not run on a device |
| Kernel hardware RNG (`/dev/hwrng`) | `hwRng()` from `@mindpeeker/entropy/node` (Linux, including the Raspberry Pi's SoC RNG); `hwRng({ path })` reads another character device. Usually root-only. Default credit 7 bits/byte | Node only |
| ChaosKey | **no dedicated provider.** The device's USB protocol (a cooked endpoint and a raw endpoint of 12-bit ADC samples) is not implemented, and WebUSB would limit it to Chromium. On Linux the in-kernel `chaoskey` driver ([source](https://github.com/torvalds/linux/blob/master/drivers/usb/misc/chaoskey.c)) registers the key as a kernel hardware RNG, which `hwRng()` reads through `/dev/hwrng` when the kernel has selected it as the current hardware RNG; this path has not been run on a ChaosKey by the maintainers | unsupported in browsers; Linux via `hwRng()` untested |
| Infinite Noise TRNG | **unsupported.** It is an FTDI FT240X device driven in bit-bang mode, so reading it needs libftdi or the vendor's [`infnoise`](https://github.com/waywardgeek/infnoise) driver; on macOS and Windows the kernel FTDI driver claims the interface, which blocks WebUSB. A Node adapter that spawns the `infnoise` CLI (as the ffmpeg adapters do) is planned for a later release | unsupported |
| BitBabbler, ComScire, Psyleron, ID Quantique Quantis USB, Crypta Labs | **unsupported**: FTDI bit-bang or libftdi-only protocols (BitBabbler, ComScire), an undocumented FTD2XX protocol (Psyleron, which stopped taking orders in 2020), a vendor library (Quantis) or an unpublished protocol (Crypta Labs) | unsupported |

## Radio

| Device | How | Status |
|---|---|---|
| RTL-SDR dongle | `sdrEntropy({ source: await rtlSdrSource() })`; `rtlSdrSource` from `@mindpeeker/entropy/node` spawns the `rtl_sdr` CLI (default 70 MHz, maximum manual gain). Pipeline after rtl-entropy: 6 least significant bits per IQ sample, von Neumann debiasing, health tests on raw. Default credit 1 bit/byte. The **RTL-SDR Blog V4 needs the rtlsdrblog driver fork**; stock drivers corrupt V4 output, which the raw health tests are there to catch | community-verified (no dongle on the maintainers' desk). Radio noise can be injected by a transmitter: use it as a mixing source, never as the only one |
| RTL-SDR over WebUSB in a browser | not shipped; the available libraries predate the V4 | experimental idea only |

## Cameras, microphones and sensors

| Source | Browser | Node | Default credit | Status |
|---|---|---|---|---|
| Camera | `cameraEntropy()` via `getUserMedia` (camera permission) | `cameraEntropy({ source: ffmpegFrameSource({ device }) })`; `device` is an avfoundation index on macOS or `/dev/video0` on Linux; needs FFmpeg 4.x–8.x | 1 bit/byte after frame-difference sign bits and von Neumann | hardware-tested on a MacBook FaceTime HD camera; raw output measured 7.02 bits/byte (most-common-value estimate). A pending macOS camera-permission prompt produces no frames: the call times out and the ffmpeg child is killed |
| Microphone | `micEntropy()` via `getUserMedia` and a `ScriptProcessorNode` (deprecated but universal) | `micEntropy({ source: ffmpegSampleSource({ device }) })`; `':0'` on macOS (avfoundation), `'default'` on Linux (ALSA) | 2 bits/byte | hardware-tested on a MacBook microphone; raw output measured 7.40 bits/byte. The browser provider requests echo cancellation, noise suppression and automatic gain control off; device DSP still varies widely |
| Motion sensors | `sensorEntropy()`: Generic Sensor API, falling back to `DeviceMotion` (iOS asks for permission; a refusal throws `EntropyError('permission')`) | — | 0.25 bits per axis byte; health-tested at 1 bit/byte so a frozen device fails | browsers quantize readings (0.1 m/s², 0.1 °/s); a breadth source to mix, not to rely on |
| CPU timing jitter | only with `allowCoarseClock: true`, named `jitter(coarse)` and credited 0.01 bits per sample; mix it through `xorMix` | `jitterEntropy()` with `hrtime`: 1/16 bit per timing delta, start-up timer self-test | see left | software source; raw output is heavily structured (Shannon 2.2 bits/byte, gzip-compressible to 10 %), which is why the credit is small |

Quality figures on this page come from the measurement tables in the entropy README
(`bun scripts/quality.ts` on the maintainers' hardware). They describe one device on one day,
not a model.

## Browser transports

Status as recorded by the research workflow from [caniuse](https://caniuse.com) in
September 2026:

| API | Support | What it means here |
|---|---|---|
| Web Serial | Chrome and Edge 89+, Chrome for Android, Firefox 151+; not Safari | `serialEntropy({ port })`, `truerng`, `onerng`. Needs a secure (HTTPS) page and a user gesture for `navigator.serial.requestPort()` |
| WebUSB | Chromium only (Firefox and Safari do not implement it; their vendors' standards positions oppose it) | cannot claim interfaces already bound to an OS driver (CDC-ACM serial, FTDI on macOS and Linux). This is also why the Web Serial polyfill over WebUSB is limited; `google/web-serial-polyfill` was archived in January 2025 |
| Web Bluetooth | Chromium only | no known Bluetooth LE TRNG profile; no provider |
| WebHID | desktop Chromium only | no provider |
| `getUserMedia` (camera, microphone) | all major browsers, secure contexts, with permission | `cameraEntropy`, `micEntropy` |
| AudioWorklet | Baseline since 2021 | not used yet: WebKit refuses `blob:` module URLs, which an asset-free worklet would need; the microphone provider uses `ScriptProcessorNode` |
| WebGPU timestamp queries | quantized to 100 µs in Chrome 121+ | too coarse to use as a jitter clock |

## Sources evaluated and not used

The entropy README keeps a longer list of sources that were considered and rejected, with
reasons (network round-trip jitter, `/proc` sampling, disk seek timing, thermal zones, RDRAND
from JavaScript, Bluetooth heart-rate straps, and others). The rule behind it follows RFC 4086: input an attacker can observe or
influence is not credited as entropy.
