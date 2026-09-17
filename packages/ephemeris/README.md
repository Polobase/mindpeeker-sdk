# @mindpeeker/ephemeris

Exact time and low-precision sky coordinates, so hypotheses about time of day, sidereal time
and the Moon can be tested against honest nulls. The package converts dates to Julian days
(Meeus ch. 7), estimates ΔT, and computes Greenwich and local sidereal time (IAU 1982 and USNO).
It also gives the Sun (Meeus ch. 25), the Moon with the complete 60 + 60 term tables of
Meeus ch. 47, the Moon's illumination (ch. 48) and the instants of its phases (ch. 49). Every
number is checked against published worked examples and independent software (ERFA, JPL
DE440s, PyMeeus, convertdate); the measured accuracy is listed below. The statistics layer
implements Spottiswoode's (1997) local-sidereal-time window scan with a seeded permutation null
that counts the peak search, plus a test for a single pre-registered window. The astronomy is
exact to the stated precision. The claim that psi performance depends on sidereal time is a
**contested hypothesis**: this package lets you test it, including against its own seasonal
confound, and does not endorse it.

Zero dependencies, ESM, browser-safe, deterministic.

## Install

```sh
bun add @mindpeeker/ephemeris   # or npm i / pnpm add
```

## Quick start

```ts
import {
  gmst,
  julianDay,
  julianEphemerisDay,
  lst,
  lstPermutationTest,
  moonIllumination,
  nextMoonPhase,
  sunPosition,
  toSexagesimal,
} from '@mindpeeker/ephemeris'

// Meeus Example 12.a: 1987 April 10, 0h UT → GMST 13h10m46.3668s
const jd = julianDay({ year: 1987, month: 4, day: 10 })
toSexagesimal(gmst(jd)) // { sign: 1, whole: 13, minutes: 10, seconds: 46.3668… }

// Local sidereal time in Edinburgh (longitude east-positive) for a Date
const now = julianDay(new Date('2026-09-17T13:00:00Z'))
lst(now, -3.19) // hours in [0, 24)

// The Sun and Moon use Terrestrial Time: convert UT → TT with ΔT first
const jde = julianEphemerisDay(now)
sunPosition(jde).rightAscension // degrees
moonIllumination(jde).illuminatedFraction // 0 … 1
nextMoonPhase(jde, 'full').jde // TT instant of the next full moon

// Spottiswoode's scan: 2 h windows every 0.1 h, ±24 h padding, peak search inside the null
const trials = [
  { time: new Date('1994-03-02T14:05:00Z'), longitudeEastDeg: -122.2, effect: 0.41, stratum: 'SRI' },
  { time: new Date('1995-11-20T10:30:00Z'), longitudeEastDeg: -3.19, effect: -0.12, stratum: 'KPU' },
  // … one entry per trial
]
const result = lstPermutationTest(trials, { permutations: 9999, seed: 20260917 })
result.scan.peak // { centerHours, mean, n, gain, centroidHours, halfWidthHours }
result.pValue // (1 + exceedances) / (1 + permutations)
```

## Time scales

| Scale | Used by | Notes |
| --- | --- | --- |
| UT (UT1 ≈ UTC) | `julianDay(Date)`, `gmst`, `gast`, `lst`, `localMeanSolarTime` | a UTC clock reading is within 0.9 s of UT1 |
| TT (JDE) | `sunPosition`, `equationOfTime`, `moonPosition`, `nutation`, `moonIllumination`, `moonPhaseTime`, `nextMoonPhase`, `moonPhases` | `julianEphemerisDay(jd)` adds ΔT; `universalJulianDay(jde)` removes it |

Longitudes are **east-positive** everywhere (Meeus writes west-positive). A number passed as a
time is a Julian day. The domain is $0 \le \mathrm{JD} \le 10^7$, which also rejects Unix
milliseconds or seconds passed by mistake.

## API

### Time

| Export | Returns | Definition |
| --- | --- | --- |
| `julianDay(date \| { year, month, day, hour?, minute?, second? }, { calendar? })` | JD | Meeus 7.1; `calendar: 'auto'` (Julian before 1582 Oct 15), `'gregorian'`, `'julian'`; Feb 30 or 1582 Oct 5–14 (auto) throw |
| `dateFromJulianDay(jd, { calendar? })` | `{ year, month, day, hour, minute, second, calendar }` | Meeus ch. 7 inverse, seconds rounded to 0.1 ms |
| `julianDayToDate(jd)` | `Date` | $t = (\mathrm{JD} - 2440587.5)\cdot 86400000$ ms |
| `julianCenturies(jd)` | T | $(\mathrm{JD} - 2451545)/36525$ |
| `decimalYear(jd)` | y | $2000 + (\mathrm{JD} - 2451545)/365.25$ |
| `deltaT(year)` | seconds | Espenak & Meeus (2006) polynomials (NASA eclipse site), no lunar-acceleration term |
| `julianEphemerisDay(jd, deltaTSeconds?)` | JDE | $\mathrm{JD} + \Delta T/86400$ |
| `universalJulianDay(jde, deltaTSeconds?)` | JD | $\mathrm{JDE} - \Delta T/86400$ |
| `UNIX_EPOCH_JD` | 2440587.5 | |

### Sidereal time

| Export | Returns | Definition |
| --- | --- | --- |
| `gmst(jd)` | hours | $\theta_0 = 280.46061837° + 360.98564736629°\,D + 0.000387933°\,T^2 - T^3/38710000$, $D = \mathrm{JD} - 2451545$ (Meeus 12.4, IAU 1982) |
| `equationOfTheEquinoxes(jd)` | hours | USNO: $\Delta\psi\cos\varepsilon$, $\Delta\psi \approx -0.000319^\mathrm{h}\sin\Omega - 0.000024^\mathrm{h}\sin 2L$ |
| `gast(jd)` | hours | GMST + equation of the equinoxes |
| `lst(jd, longitudeEastDeg, { sidereal? })` | hours | $\mathrm{GMST}$ (or GAST with `'apparent'`) $+ \lambda/15$ |
| `localMeanSolarTime(jd, longitudeEastDeg)` | hours | $\mathrm{UT} + \lambda/15$, for clock-time strata |

### Sun, Moon and phases

| Export | Returns | Definition |
| --- | --- | --- |
| `nutation(jde)` | `{ longitude, obliquity, meanObliquity, trueObliquity }` (deg) | Meeus ch. 22 four-term series (0.5″ / 0.1″) and eq. 22.2 |
| `meanObliquity(jde)` | deg | $23°26'21.448'' - 46.8150''T - 0.00059''T^2 + 0.001813''T^3$ |
| `sunPosition(jde)` | `{ longitude, trueLongitude, meanLongitude, meanAnomaly, distanceAu, rightAscension, declination, obliquity }` | Meeus ch. 25 low accuracy: equation of centre, $\lambda = \odot - 0.00569° - 0.00478°\sin\Omega$ |
| `equationOfTime(jde)` | minutes | Meeus 28.3 (Smart): $y\sin 2L_0 - 2e\sin M + 4ey\sin M\cos 2L_0 - \frac12 y^2\sin 4L_0 - \frac54 e^2\sin 2M$ |
| `moonPosition(jde)` | `{ longitude, latitude, meanEquinoxLongitude, distanceKm, horizontalParallax, rightAscension, declination }` | Meeus ch. 47, full Tables 47.A/47.B, $E$ factor, additive terms, $+\Delta\psi$ |
| `moonIllumination(jde)` | `{ phaseAngle, illuminatedFraction, elongation, longitudeFromSun, brightLimbAngle, waxing }` | Meeus 48.2, 48.3, 48.5: $k = (1+\cos i)/2$ |
| `moonPhaseTime(k)` | JDE | Meeus ch. 49: mean phase + periodic terms + $\pm W$ + $A_1 \dots A_{14}$; `k` integer = new moon, +0.25/0.5/0.75 |
| `nextMoonPhase(jde, phase?)` | `{ phase, k, jde }` | first principal phase at or after `jde` |
| `moonPhases(startJde, endJde, phase?)` | `MoonPhaseEvent[]` | all phases in $[\mathrm{start}, \mathrm{end})$, ≤ 10 000 years |

### LST analyses

| Export | Purpose |
| --- | --- |
| `lstWindowScan(trials, { windowHours = 2, stepHours = 0.1, pad = true, minTrials = 1, sidereal = 'mean' })` | Boxcar mean effect per window, with n, SD and SE; peak, gain, centroid and half width |
| `lstPermutationTest(trials, { …scan options, permutations = 9999, seed = 0 })` | Scan-aware permutation p for the largest window mean |
| `lstWindowTest(trials, { centerHours, halfWidthHours, permutations = 9999, seed = 0, sidereal })` | One pre-registered window: inside vs outside mean, one-sided permutation p |

A trial is either `{ time: Date | JD, longitudeEastDeg, effect, stratum? }` or
`{ lstHours, effect, stratum? }`. When trials carry a `stratum`, effects are exchanged only
within strata. Give a stratum on every trial or on none.

### Helpers and errors

`normalizeDegrees`, `normalizeHours`, `toSexagesimal`. Every failure throws `EphemerisError` with
a stable `code`:

| Code | When |
| --- | --- |
| `invalid_time` | invalid `Date`, malformed or nonexistent calendar date, Julian day outside $[0, 10^7]$ |
| `invalid_input` | non-finite angle, longitude or effect, malformed trial, `k` not a multiple of 0.25 |
| `invalid_options` | bad window, step, `minTrials`, permutation count, seed, calendar, sidereal mode or phase name |
| `insufficient_data` | no trials (permutation tests: fewer than two), no admissible window, empty window or complement |

## The window scan and its null

Following Spottiswoode (1997), window $j$ is centred at $c_j = 24j/N$ with $N = 24/\text{step}$
and holds the trials with $c_j - w/2 \le \mathrm{LST} < c_j + w/2$. The data are padded with
copies at $\mathrm{LST} \pm 24$ h, so windows wrap around the sidereal day. Each window reports
$\bar e_j$, $n_j$ and the SD. The **peak** is $\max_j \bar e_j$ over the windows with
$n_j \ge$ `minTrials`, and the **gain** is $\bar e_\mathrm{peak} / \bar e$. The paper does not
give a formula for its centroid. This package takes the contiguous run of windows around the
peak whose mean is at least halfway between the overall mean and the peak, and weights each
window by its excess over that level. The half width is half the run's length.

`lstPermutationTest` relabels effects against LST $m$ times (seeded xoshiro128** Fisher–Yates),
repeats the **whole scan** each time, and reports

$$p = \frac{1 + \#\{b : \max_j \bar e^{(b)}_j \ge \max_j \bar e_j\}}{1 + m}.$$

Because every relabeling also searches all windows, the multiplicity of the peak search is
already paid for, and $P(p \le \alpha) \le \alpha$ holds exactly under exchangeability. The test
suite checks this on 300 null datasets. It also checks the result against exact enumeration of
all $7!$ relabelings of a small data set. Spottiswoode reported $b/m = 14/10\,000$; the add-one
estimator gives $15/10\,001 \approx 0.0015$ for the same count. Relabelings do not change the
overall mean, so the largest mean and the largest gain give the same test. To test for a
trough, negate the effects.

`lstWindowTest` is the confirmatory test. It fixes a window **before** the data exist, for
example 13.47 h ± 1 h for a new sample, and compares the inside mean with the outside mean.
There is no search, so there is no multiplicity. A window read off a scan of the same data is
not pre-registered.

## The Spottiswoode LST hypothesis — what was claimed, and why it is contested

**Claim.** Spottiswoode (1997) binned 1,468 free-response anomalous-cognition trials from 21
studies by local sidereal time. The overall effect size was 0.148 (Stouffer Z 5.99). Trials
within ±1 h of 13.47 h LST averaged 0.507 (n = 83), a gain of 3.42. A validation set of 1,015
trials (overall effect size 0.085) peaked at the same 13.47 h, with a gain of 4.51 within ±1 h
(n = 43, one-tailed p = 0.05). For all 2,483 trials, 14 of 10,000 permutations produced a
window mean at least as large as the observed one. A 1998 follow-up with 2,879 trials found the
ap geomagnetic correlation concentrated inside the LST band: ρ = −0.192 in 11.2–14.8 h
(N = 256) against −0.010 outside. Sources: McMoneagle, *Remote Viewing Secrets*, which reprints
both papers in App. B, pp. 228–238, and App. C, pp. 247–248.

**Why it is contested.**

- **Seasonal and clock-time confound.** Spottiswoode checked clock time: 81% of trials fell
  between 09:00 and 17:00, and removing the means of 1-hour clock-time bins left the LST plot
  "virtually indistinguishable" (App. B, p. 236). That check does not cover the season. He
  noted that LST "is a linear function of local solar time and the day of the year", so "some
  undiscovered systematic relationship between effect size and these variables might be
  responsible for the observed peak" (p. 238). Ryan (2008, p. 337) makes this concrete.
  Most trials ran in daylight hours, so any seasonal factor becomes a variation in LST. The
  same database shows a seasonal variation (Sturrock & Spottiswoode 2007), which "will, at
  least partly, explain the shape of the LST graph".
- **Study mix and data quality.** Trial times were probably session starts, off by up to a
  quarter of an hour. Latitudes covered only 32–55° N. The PEAR remote-viewing data were
  included despite methodological criticism (App. B, pp. 228–229). Studies differ in effect
  size and in when they ran. The analysis was retrospective: the 13.47 h peak was found by
  scanning the first data set.
- **Replication.** According to the Psi Encyclopedia's summary of Ryan & Spottiswoode (2015), a
  relationship with sidereal time appeared in fresh data, but the peak moved (from 13:30 to
  08:30 LST). The overall correlation with geomagnetic activity across 6,000 trials was not
  significant.

**Testing it honestly with this package.**

1. For confirmation, pre-register a single window, a seed and a permutation count, and use
   `lstWindowTest` on data collected after registration.
2. For exploration, report `lstPermutationTest`. Its p already includes the search over 240
   windows.
3. Stratify by study (`stratum: studyId`). Relabeling then cannot move effects between studies
   that ran at different sidereal times. The test suite shows an unstratified null rejecting in
   more than 90% of such mixes, while the stratified null stays at 5%.
4. Stratify by clock time. For example, use `Math.floor(localMeanSolarTime(jd, lon))` or a
   (clock hour × season) cell, to ask whether LST explains anything beyond time of day and
   season. Finer strata leave less LST variation inside each stratum, so power falls. That
   loss is the cost of the confound, not a flaw of the test.

## Accuracy

Measured against independent references. The generators are in `scripts/fixtures/` and the
checked-in outputs in `test/fixtures/`, and the tests assert these bounds.

| Quantity | Reference | Largest difference |
| --- | --- | --- |
| Julian day (150 dates, −4700…3000, both calendars) | convertdate, ERFA `cal2jd` | 1.5 × 10⁻¹¹ d |
| GMST (300 instants, 1800–2200) | ERFA `gmst82` | 0.07 ms |
| GAST (same) | ERFA `gst94` (full IAU 1980 nutation) | 0.036 s |
| ΔT 1962.5–2004.5 | IERS-B (astropy) | 0.97 s (2025: 74.5 s vs observed 69.1 s) |
| Sun λ / α / δ / R (150 instants, 1900–2100) | astropy `get_sun` (ERFA) | 28″ / 29″ / 11″ / 0.00007 AU |
| Equation of time (same) | GAST − apparent solar RA (ERFA) | 3.2 s |
| Moon λ / β / Δ (150 instants, 1900–2100) | JPL DE440s geometric geocentric | 10.5″ (RMS 2.9″) / 3.7″ / 7.1 km |
| Moon tables 47.A/47.B | ERFA `moon98.c`, meeus (Go) — term by term | identical (240 rows) |
| Phase angle / illuminated fraction | DE440s vectors | 0.011° / 0.0001 |
| Phase instants (33 events, 1950–2050) | roots of DE440s Moon − apparent Sun | 12.6 s |
| Phase instants (60 events) | PyMeeus | < 0.1 ms |

Worked examples reproduced in the tests: Meeus 7.a–7.c and the ch. 7 table, 12.a, 12.b, 22.a,
25.a, 28.b, 47.a, 48.a, 49.a and 49.b.

## Verification

- `bun test` covers the worked examples, the fixtures above, brute-force window
  means, exact-enumeration checks of both permutation tests, calibration on null data, detection
  of planted effects, and determinism for a given seed.
- `uv run packages/ephemeris/scripts/fixtures/generate.py` regenerates the fixtures (astropy,
  jplephem, PyMeeus, convertdate). If astropy cannot download `de440s.bsp`, set `EPHEMERIS_BSP`.
- `uv run packages/ephemeris/scripts/fixtures/check_moon_tables.py` diffs the lunar tables
  against ERFA and the Go port.

## Sources

- J. Meeus, *Astronomical Algorithms*, 2nd ed., Willmann-Bell 1998: ch. 7 (Julian day),
  12 (sidereal time), 13 (coordinates), 22 (nutation), 25 (Sun), 28 (equation of time),
  47 (Moon), 48 (illumination), 49 (phases).
- U.S. Naval Observatory, *Computing Greenwich Apparent Sidereal Time*,
  aa.usno.navy.mil/faq/GAST.
- F. Espenak & J. Meeus, *Five Millennium Canon of Solar Eclipses* (NASA TP-2006-214141),
  ΔT polynomials: eclipse.gsfc.nasa.gov/SEhelp/deltatpoly2004.html.
- D. Blackman & S. Vigna, *Scrambled linear pseudorandom number generators*, ACM TOMS 2021
  (xoshiro128**); G. Steele, D. Lea & C. Flood, SplitMix, OOPSLA 2014.
- S. J. P. Spottiswoode, "Apparent association between effect size in free response anomalous
  cognition experiments and local sidereal time", *J. Scientific Exploration* 11(2), 1997.
  Reprinted with the 1998 geomagnetic follow-up in J. McMoneagle, *Remote Viewing Secrets*
  (2000), Appendix B.
- P. A. Sturrock & S. J. P. Spottiswoode, "Time-series power spectrum analysis of performance
  in free response anomalous cognition experiments", *J. Scientific Exploration* 21, 47–66
  (2007).
- A. Ryan, "New insights into the links between ESP and geomagnetic activity", *J. Scientific
  Exploration* 22(3), 335–358 (2008).
- A. Ryan & S. J. P. Spottiswoode, "Variation of ESP by season, local sidereal time and
  geomagnetic activity", in E. May & S. Marwaha (eds.), *Extrasensory Perception: Support,
  Skepticism and Science*, vol. 1, Praeger 2015. Summarised in the SPR Psi Encyclopedia,
  "Adrian Ryan".

## Behaviour changes in 0.2.0

- New package.

## License

MIT
