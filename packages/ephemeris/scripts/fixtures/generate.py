# /// script
# requires-python = ">=3.11"
# dependencies = ["astropy>=6", "jplephem>=2.21", "pymeeus>=0.5.12", "convertdate>=2.4", "scipy>=1.11", "numpy>=1.26"]
# ///
"""Generate independent reference fixtures for @mindpeeker/ephemeris.

Run manually (never at test time):

    uv run packages/ephemeris/scripts/fixtures/generate.py

If astropy cannot download the JPL kernel (e.g. TLS trust problems), fetch
https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp
yourself and pass its path in EPHEMERIS_BSP.

Every number comes from software that shares no code with the package:

- ERFA (via pyerfa/astropy): gmst82 / gst94 sidereal time, the apparent Sun
  (astropy `get_sun` → true ecliptic and TETE frames), observed ΔT = TT − UT1
  from the bundled IERS-B table, and `erfa.moon98` — ERFA's own transcription
  of Meeus ch. 47 — as a term-by-term transcription check of our tables.
- JPL DE440s (astropy `get_body_barycentric(..., ephemeris='de440s')`): the
  geometric geocentric Moon (Moon − Earth at the same TDB) as the physical
  truth for the Moon's accuracy statement, the phase angle and the phase
  roots. (astropy's `get_body` "apparent" Moon applies a barycentric
  light-time correction that moves it by 10–80″ from the geocentric apparent
  place Meeus defines, so it is not used.)
- convertdate and ERFA cal2jd: Julian and Gregorian calendar day numbers.
- PyMeeus: an independent transcription of Meeus ch. 49 phase instants.
- A local Python transcription of splitmix64 + xoshiro128** for the PRNG.

Writes JSON files into packages/ephemeris/test/fixtures/.
"""

import json
import math
import os
import platform
import random
from pathlib import Path

import astropy
import erfa
import numpy as np
import scipy
from astropy import units as u
from astropy.coordinates import (
    GCRS,
    TETE,
    CartesianRepresentation,
    GeocentricTrueEcliptic,
    SkyCoord,
    get_body_barycentric,
    get_sun,
)
from astropy.time import Time
from astropy.utils import iers
from convertdate import gregorian as cd_gregorian
from convertdate import julian as cd_julian
from pymeeus.Epoch import Epoch
from pymeeus.Moon import Moon
from scipy.optimize import brentq

iers.conf.auto_download = False
JPL = os.environ.get("EPHEMERIS_BSP", "de440s")

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = (
    f"python {platform.python_version()}, astropy {astropy.__version__}, "
    f"pyerfa {erfa.__version__}, scipy {scipy.__version__}"
)
TWO_PI = 2.0 * math.pi


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1) + "\n")
    print(f"wrote {path}")


def julian_fixture(rng: random.Random) -> None:
    cases = []
    for _ in range(150):
        calendar = rng.choice(["julian", "gregorian"])
        year = rng.randint(-4700, 3000)
        month = rng.randint(1, 12)
        day = rng.randint(1, 28)
        fraction = rng.randint(0, 9999) / 10000
        if calendar == "julian":
            jd0 = cd_julian.to_jd(year, month, day)
        else:
            jd0 = cd_gregorian.to_jd(year, month, day)
            mjd0, mjd = erfa.cal2jd(year, month, day)
            assert abs((mjd0 + mjd) - jd0) < 1e-9, (year, month, day)
        cases.append(
            {
                "calendar": calendar,
                "year": year,
                "month": month,
                "day": day + fraction,
                "jd": jd0 + fraction,
            }
        )
    write("julian.json", {"source": "convertdate + erfa.cal2jd", "cases": cases})


def sidereal_fixture(rng: random.Random) -> None:
    cases = []
    for _ in range(300):
        jd = 2378496.5 + rng.random() * 146097.0  # 1800-01-01 .. 2200-01-01
        gmst = erfa.gmst82(jd, 0.0) * 12.0 / math.pi
        gst = erfa.gst94(jd, 0.0) * 12.0 / math.pi
        cases.append({"jd": jd, "gmstHours": gmst, "gastHours": gst})
    write(
        "sidereal.json",
        {"source": "erfa.gmst82 (IAU 1982) and erfa.gst94 (IAU 1982/94, full nutation)", "cases": cases},
    )


def delta_t_fixture() -> None:
    cases = []
    for year in np.arange(1962.5, 2026.0, 0.5):
        t = Time(float(year), format="jyear", scale="utc")
        dt = (t.tt.jd1 - t.ut1.jd1) * 86400.0 + (t.tt.jd2 - t.ut1.jd2) * 86400.0
        cases.append({"year": float(year), "deltaT": dt})
    write("delta-t.json", {"source": "astropy IERS-B: TT - UT1", "cases": cases})


def sun_fixture(rng: random.Random) -> None:
    cases = []
    for _ in range(150):
        jde = 2415020.5 + rng.random() * 73049.0  # 1900..2100
        t = Time(jde, format="jd", scale="tt")
        sun = get_sun(t)
        ecl = sun.transform_to(GeocentricTrueEcliptic(equinox=t))
        tete = sun.transform_to(TETE(obstime=t))
        gast = erfa.gst94(jde, 0.0) * 12.0 / math.pi  # UT1 := TT for this definition check
        ut_hours = ((jde + 0.5) % 1.0) * 24.0
        e_hours = (gast - tete.ra.hour + 12.0 - ut_hours) % 24.0
        if e_hours > 12.0:
            e_hours -= 24.0
        cases.append(
            {
                "jde": jde,
                "longitude": ecl.lon.deg,
                "distanceAu": ecl.distance.to(u.au).value,
                "rightAscension": tete.ra.deg,
                "declination": tete.dec.deg,
                "equationOfTimeMinutes": e_hours * 60.0,
            }
        )
    write("sun.json", {"source": "astropy get_sun -> GeocentricTrueEcliptic / TETE; E = GAST - RA + 12h - UT", "cases": cases})


def de_geocentric(body: str, t: Time) -> SkyCoord:
    """Geometric geocentric position of `body` from DE440s, in GCRS at `t`."""
    rel = get_body_barycentric(body, t, ephemeris=JPL) - get_body_barycentric("earth", t, ephemeris=JPL)
    return SkyCoord(rel, frame=GCRS(obstime=t))


def moon_fixture(rng: random.Random) -> None:
    cases = []
    for _ in range(150):
        jde = 2415020.5 + rng.random() * 73049.0
        t = Time(jde, format="jd", scale="tt")
        frame = GeocentricTrueEcliptic(equinox=t)
        # Transcription check: ERFA moon98 (Meeus ch. 47, geometric, GCRS) in the true ecliptic of date.
        pos, _vel = erfa.moon98(jde, 0.0)
        m98 = SkyCoord(CartesianRepresentation(pos * u.au), frame=GCRS(obstime=t)).transform_to(frame)
        # Physical truth: JPL DE440s, geometric geocentric.
        moon = de_geocentric("moon", t)
        sun = de_geocentric("sun", t)
        ecl = moon.transform_to(frame)
        tete = moon.transform_to(TETE(obstime=t))
        m = moon.cartesian.xyz.to(u.km).value
        s_ = sun.cartesian.xyz.to(u.km).value
        to_earth = -m
        to_sun = s_ - m
        cos_i = float(np.dot(to_earth, to_sun) / (np.linalg.norm(to_earth) * np.linalg.norm(to_sun)))
        i = math.acos(max(-1.0, min(1.0, cos_i)))
        cases.append(
            {
                "jde": jde,
                "moon98": {
                    "longitude": m98.lon.deg,
                    "latitude": m98.lat.deg,
                    "distanceKm": m98.distance.to(u.km).value,
                },
                "de440s": {
                    "longitude": ecl.lon.deg,
                    "latitude": ecl.lat.deg,
                    "distanceKm": float(np.linalg.norm(m)),
                    "rightAscension": tete.ra.deg,
                    "declination": tete.dec.deg,
                    "phaseAngle": math.degrees(i),
                    "illuminatedFraction": (1 + math.cos(i)) / 2,
                },
            }
        )
    write("moon.json", {"source": "erfa.moon98 (transcription check); JPL DE440s geometric geocentric (accuracy)", "cases": cases})


def elongation(jde: float, target: float) -> float:
    t = Time(jde, format="jd", scale="tt")
    frame = GeocentricTrueEcliptic(equinox=t)
    lm = de_geocentric("moon", t).transform_to(frame).lon.deg
    ls = get_sun(t).transform_to(frame).lon.deg
    return ((lm - ls - target + 180.0) % 360.0) - 180.0


def phase_fixture(rng: random.Random) -> None:
    names = ["new", "first", "full", "last"]
    ours = ["new", "firstQuarter", "full", "lastQuarter"]
    cases = []
    for _ in range(60):
        k = rng.randint(-1200, 1200) + rng.choice([0, 0.25, 0.5, 0.75])
        q = int(round((k % 1) * 4)) % 4
        mean = 2451550.09766 + 29.530588861 * k
        # PyMeeus derives k from the decimal year; probe nearby epochs until it lands on ours.
        candidates = [Moon.moon_phase(Epoch(mean + d), target=names[q]).jde() for d in (0, -7, 7, -14, 14)]
        matches = [c for c in candidates if abs(c - mean) < 2]
        if not matches:
            raise RuntimeError(f"pymeeus did not reach lunation k={k}")
        pm = matches[0]
        case = {"k": k, "phase": ours[q], "pymeeusJde": pm}
        if 2433282.5 <= mean <= 2469807.5:  # 1950..2050: root-find with DE440s positions
            case["de440sJde"] = brentq(lambda x: elongation(x, 90.0 * q), pm - 0.1, pm + 0.1, xtol=1e-9)
        cases.append(case)
    write("phases.json", {"source": "PyMeeus Moon.moon_phase; root of DE440s geometric Moon minus apparent Sun longitude (1950-2050)", "cases": cases})


MASK64 = (1 << 64) - 1
MASK32 = (1 << 32) - 1


def mix64(z: int) -> int:
    z &= MASK64
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
    return z ^ (z >> 31)


def xoshiro_outputs(seed: int, count: int) -> list[int]:
    state = seed
    outs = []
    for _ in range(2):
        state = (state + 0x9E3779B97F4A7C15) & MASK64
        outs.append(mix64(state))
    s = [outs[0] >> 32, outs[0] & MASK32, outs[1] >> 32, outs[1] & MASK32]
    rotl = lambda x, k: ((x << k) | (x >> (32 - k))) & MASK32
    result = []
    for _ in range(count):
        result.append((rotl((s[1] * 5) & MASK32, 7) * 9) & MASK32)
        t = (s[1] << 9) & MASK32
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = rotl(s[3], 11)
    return result


def prng_fixture() -> None:
    cases = [{"seed": seed, "outputs": xoshiro_outputs(seed, 8)} for seed in [0, 1, 42, 2**53 - 1]]
    write("prng.json", {"source": "Python splitmix64 -> xoshiro128** transcription", "cases": cases})


def main() -> None:
    rng = random.Random(20260917)
    julian_fixture(rng)
    sidereal_fixture(rng)
    delta_t_fixture()
    sun_fixture(rng)
    moon_fixture(rng)
    phase_fixture(rng)
    prng_fixture()


if __name__ == "__main__":
    main()
