# @mindpeeker/ephemeris

## 0.2.0

### Minor Changes

- New package, first release on npm. Exact time and low-precision sky coordinates with no dependencies: Julian day and ΔT, Greenwich and local sidereal time (IAU 1982 and USNO), the Sun (Meeus ch. 25), the Moon with the full Meeus ch. 47 term tables, lunar illumination and phase times, each checked against published worked examples and independent software. It also implements Spottiswoode's (1997) local-sidereal-time window scan with a seeded permutation null that includes the peak search, and a test for one pre-registered window. That psi performance depends on sidereal time is a contested hypothesis; the package lets you test it, including against its seasonal confound, and does not endorse it.
