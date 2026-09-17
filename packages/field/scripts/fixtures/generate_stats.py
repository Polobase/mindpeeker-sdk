# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0", "scipy>=1.13"]
# ///
"""Independent reference values for @mindpeeker/field 0.2 statistics (part 1).

Run manually (never at test time):

    uv run packages/field/scripts/fixtures/generate_stats.py

Writes test/fixtures/stats.json. Nothing here ports the TypeScript: areas and
circumference fractions come from numerical integration and root finding
(scipy.integrate.quad, scipy.optimize.brentq), neighbour counts from
scipy.spatial.cKDTree, binomial tails from scipy.stats.binom, quadrat tests
from scipy.stats.chisquare / power_divergence, and the K-function estimators
follow the definitions in spatstat's Kest.R / edgeRipley.R / edgeTrans.R and
clarkevans.R (Baddeley, Rubak & Turner 2015) evaluated with those numerics.
"""

import json
import math
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy import integrate, optimize, stats
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist

FIXTURES = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, numpy {np.__version__}, scipy {scipy.__version__}"
QUAD = dict(limit=400, epsabs=1e-13, epsrel=1e-12)


# ---------------------------------------------------------------- geometry


def chord_area(x0, x1, lower, upper):
    """∫ max(0, upper(x) - lower(x)) dx over [x0, x1] by adaptive quadrature."""
    if x1 <= x0:
        return 0.0
    val, _ = integrate.quad(lambda x: max(0.0, upper(x) - lower(x)), x0, x1, **QUAD)
    return val


def circle_rect_area(cx, cy, r, w, h):
    a, b = max(0.0, cx - r), min(w, cx + r)

    def half(x):
        return math.sqrt(max(0.0, r * r - (x - cx) ** 2))

    breaks = [a, b]
    for yb in (0.0, h):
        dy = yb - cy
        if abs(dy) < r:
            dx = math.sqrt(r * r - dy * dy)
            breaks += [cx - dx, cx + dx]
    breaks = sorted({p for p in breaks if a <= p <= b})
    total = 0.0
    for lo, hi in zip(breaks, breaks[1:]):
        total += chord_area(lo, hi, lambda x: max(0.0, cy - half(x)), lambda x: min(h, cy + half(x)))
    return total


def disk_disk_area(rho, r, big):
    """|B((rho, 0), r) ∩ B(0, big)| by quadrature over x."""
    a, b = max(-big, rho - r), min(big, rho + r)
    if b <= a:
        return 0.0

    def top(x):
        return min(math.sqrt(max(0.0, r * r - (x - rho) ** 2)), math.sqrt(max(0.0, big * big - x * x)))

    breaks = {a, b}
    if rho > 0:
        xc = (rho * rho + big * big - r * r) / (2 * rho)
        if a < xc < b:
            breaks.add(xc)
    breaks = sorted(breaks)
    return sum(2 * chord_area(lo, hi, lambda x: 0.0, top) for lo, hi in zip(breaks, breaks[1:]))


def arc_fraction(margin, samples=4096):
    """Measure of {θ : margin(θ) > 0} / 2π, crossings refined with brentq."""
    thetas = np.linspace(0.0, 2 * math.pi, samples + 1)
    values = np.array([margin(t) for t in thetas])
    cuts = [0.0]
    for i in range(samples):
        if values[i] == 0.0:
            cuts.append(thetas[i])
        elif values[i] * values[i + 1] < 0:
            cuts.append(optimize.brentq(margin, thetas[i], thetas[i + 1], xtol=1e-15, rtol=1e-15))
    cuts.append(2 * math.pi)
    cuts = sorted(set(cuts))
    inside = sum(hi - lo for lo, hi in zip(cuts, cuts[1:]) if margin((lo + hi) / 2) > 0)
    return inside / (2 * math.pi)


def rect_margin(px, py, r, w, h):
    return lambda t: min(px + r * math.cos(t), w - px - r * math.cos(t), py + r * math.sin(t), h - py - r * math.sin(t))


def disk_margin(px, py, r, big):
    return lambda t: big - math.hypot(px + r * math.cos(t), py + r * math.sin(t))


def region_area(region):
    return region["width"] * region["height"] if region["kind"] == "rect" else math.pi * region["radius"] ** 2


def clip_area(p, r, region):
    if region["kind"] == "rect":
        return circle_rect_area(p[0], p[1], r, region["width"], region["height"])
    return disk_disk_area(math.hypot(p[0], p[1]), r, region["radius"])


def border(p, region):
    if region["kind"] == "rect":
        return max(0.0, min(p[0], region["width"] - p[0], p[1], region["height"] - p[1]))
    return max(0.0, region["radius"] - math.hypot(p[0], p[1]))


def arc(p, r, region):
    if r <= border(p, region):
        return 1.0
    if region["kind"] == "rect":
        return arc_fraction(rect_margin(p[0], p[1], r, region["width"], region["height"]))
    return arc_fraction(disk_margin(p[0], p[1], r, region["radius"]))


def overlap(dx, dy, region):
    if region["kind"] == "rect":
        # length of [0, w] ∩ [dx, w + dx] times the same in y
        ox = max(0.0, min(region["width"], region["width"] + dx) - max(0.0, dx))
        oy = max(0.0, min(region["height"], region["height"] + dy) - max(0.0, dy))
        return ox * oy
    return disk_disk_area(math.hypot(dx, dy), region["radius"], region["radius"])


def geometry_cases():
    rect = [(5, 5, 2), (0.5, 0.3, 2), (0, 0, 3), (9, 7, 4), (1, 9 - 1, 1.5), (5, 5, 6), (10, 4, 5), (3, 2, 9.5)]
    arcs = [(5, 4, 2), (1, 1, 2), (0, 0, 1), (0, 4, 1), (2, 3, 6), (9.5, 7.5, 11), (7, 1, 3.3), (5, 4, 6.4)]
    disk = [(0, 3), (3, 3), (4.5, 1), (2, 9), (4.9, 0.4), (1, 5.5), (3.7, 8.6)]
    return {
        "rect": {"width": 10, "height": 8},
        "circleRect": [{"cx": cx, "cy": cy, "r": r, "area": circle_rect_area(cx, cy, r, 10, 8)} for cx, cy, r in rect],
        "arcRect": [
            {"x": x, "y": y, "r": r, "fraction": arc_fraction(rect_margin(x, y, r, 10, 8))} for x, y, r in arcs
        ],
        "diskRadius": 5,
        "lens": [{"rho": rho, "r": r, "area": disk_disk_area(rho, r, 5)} for rho, r in disk],
        "arcDisk": [
            {"rho": rho, "r": r, "fraction": arc_fraction(disk_margin(rho, 0.0, r, 5))} for rho, r in disk
        ],
    }


# ---------------------------------------------------------------- statistics


def hotspots(pts, region, expected_neighbours=4.0):
    n = len(pts)
    area = region_area(region)
    radius = math.sqrt(expected_neighbours * area / ((n - 1) * math.pi))
    counts = cKDTree(pts).query_ball_point(pts, radius, return_length=True) - 1
    order_max = sorted(range(n), key=lambda i: (-counts[i], pts[i][0], pts[i][1]))
    order_min = sorted(range(n), key=lambda i: (counts[i], pts[i][0], pts[i][1]))
    out = {"radius": radius, "expectedNeighbours": (n - 1) * math.pi * radius**2 / area}
    for name, i, tail in (("attractor", order_max[0], "upper"), ("void", order_min[0], "lower")):
        k = int(counts[i])
        p = clip_area(pts[i], radius, region) / area
        mu = (n - 1) * p
        p_single = float(stats.binom.sf(k - 1, n - 1, p)) if tail == "upper" else float(stats.binom.cdf(k, n - 1, p))
        out[name] = {
            "point": {"x": float(pts[i][0]), "y": float(pts[i][1])},
            "neighbours": k,
            "expected": mu,
            "power": k / mu,
            "z": (k - mu) / math.sqrt(mu),
            "pSingle": p_single,
        }
    return out


def clark_evans_donnelly(pts, region):
    n = len(pts)
    area = region_area(region)
    dist, _ = cKDTree(pts).query(pts, k=2)
    d_obs = float(dist[:, 1].mean())
    d_pois = 1 / (2 * math.sqrt(n / area))
    perim = 2 * (region["width"] + region["height"])
    d_kevin = d_pois + (0.0514 + 0.0412 / math.sqrt(n)) * perim / n
    se = 0.26136 * math.sqrt(area) / n  # Clark & Evans's published constant
    z = (d_obs - d_kevin) / se
    return {"meanNearest": d_obs, "expectedNearest": d_kevin, "R": d_obs / d_kevin, "z": z, "pValue": 2 * stats.norm.sf(abs(z))}


def ripley_k(pts, region, radii, correction, denominator):
    n = len(pts)
    area = region_area(region)
    d = cdist(pts, pts)
    np.fill_diagonal(d, np.inf)
    if correction == "border":
        b = np.array([border(p, region) for p in pts])
        lam = (n if denominator == "n2" else n - 1) / area
        out = []
        for r in radii:
            elig = b >= r
            count = int(elig.sum())
            num = int((d[elig] <= r).sum())
            out.append(num / (lam * count) if count else None)
        return out
    rmax = max(radii)
    ii, jj = np.nonzero(d <= rmax)
    weights = np.ones(len(ii))
    for k, (i, j) in enumerate(zip(ii, jj)):
        if correction == "isotropic":
            weights[k] = min(100.0, max(1.0, 1.0 / max(arc(pts[i], d[i, j], region), 1e-300)))
        elif correction == "translation":
            dx, dy = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
            weights[k] = min(100.0, area / overlap(dx, dy, region))
    denom = n * n if denominator == "n2" else n * (n - 1)
    dij = d[ii, jj]
    return [area * float(weights[dij <= r].sum()) / denom for r in radii]


def quadrat(pts, region, nx, ny):
    n = len(pts)
    area = region_area(region)
    if region["kind"] == "rect":
        x0, y0, x1, y1 = 0.0, 0.0, region["width"], region["height"]
    else:
        big = region["radius"]
        x0, y0, x1, y1 = -big, -big, big, big
    xe = np.linspace(x0, x1, nx + 1)
    ye = np.linspace(y0, y1, ny + 1)
    hist, _, _ = np.histogram2d(pts[:, 0], pts[:, 1], bins=[xe, ye])
    counts, expected = [], []
    for iy in range(ny):
        for ix in range(nx):
            counts.append(int(hist[ix, iy]))
            if region["kind"] == "rect":
                cell = (xe[ix + 1] - xe[ix]) * (ye[iy + 1] - ye[iy])
            else:
                cell = circle_rect_area(-xe[ix], -ye[iy], region["radius"], xe[ix + 1] - xe[ix], ye[iy + 1] - ye[iy])
            expected.append(n * cell / area)
    obs = np.array(counts, dtype=float)
    exp = np.array(expected)
    df = len(obs) - 1
    pearson = stats.chisquare(obs, exp, ddof=0).statistic
    g2 = stats.power_divergence(obs, exp, lambda_="log-likelihood").statistic

    def two_sided(x):
        return min(1.0, 2 * min(stats.chi2.sf(x, df), stats.chi2.cdf(x, df)))

    return {
        "nx": nx,
        "ny": ny,
        "counts": counts,
        "expected": expected,
        "df": df,
        "pearson": float(pearson),
        "pearsonP": two_sided(pearson),
        "pearsonClusteredP": float(stats.chi2.sf(pearson, df)),
        "g2": float(g2),
        "g2P": two_sided(g2),
        "dispersionIndex": float(pearson / df),
    }


def main():
    field = json.loads((FIXTURES / "field.json").read_text())
    rng = np.random.default_rng(20260917)
    big = 50.0
    u, v = rng.uniform(size=150), rng.uniform(size=150)
    disk_pts = np.column_stack([big * np.sqrt(u) * np.cos(2 * np.pi * v), big * np.sqrt(u) * np.sin(2 * np.pi * v)])
    cases = [
        {"label": c["label"], "region": c["region"], "points": np.array([[p["x"], p["y"]] for p in c["points"]])}
        for c in field["cases"]
    ]
    cases.append({"label": "disk150", "region": {"kind": "disk", "radius": big}, "points": disk_pts})
    out_cases = []
    for c in cases:
        pts, region = c["points"], c["region"]
        radii = [2.0, 4.0, 6.0, 8.0, 10.0, 14.0] if region["kind"] == "rect" else [3.0, 6.0, 9.0, 12.0]
        k = {
            f"{corr}|{den}": ripley_k(pts, region, radii, corr, den)
            for corr in ("none", "border", "isotropic", "translation")
            for den in ("n2", "n(n-1)")
        }
        entry = {
            "label": c["label"],
            "region": region,
            "points": [{"x": float(x), "y": float(y)} for x, y in pts],
            "hotspots": hotspots(pts, region),
            "radii": radii,
            "ripleyK": k,
            "quadrat": quadrat(pts, region, 5, 4) if region["kind"] == "rect" else quadrat(pts, region, 6, 6),
        }
        if region["kind"] == "rect":
            entry["clarkEvansDonnelly"] = clark_evans_donnelly(pts, region)
        out_cases.append(entry)
        print(f"done {c['label']}")
    payload = {"generator": GENERATOR, "geometry": geometry_cases(), "cases": out_cases}
    (FIXTURES / "stats.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {FIXTURES / 'stats.json'}")


if __name__ == "__main__":
    main()
