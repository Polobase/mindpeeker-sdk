# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0", "scipy>=1.13", "pygeohash>=3.0"]
# ///
"""Independent reference values for @mindpeeker/field 0.2 statistics (part 2).

Run manually (never at test time):

    uv run packages/field/scripts/fixtures/generate_density.py

Writes test/fixtures/density.json:

- kernel density grids from scipy.stats.gaussian_kde (rules) and
  scipy.stats.multivariate_normal (fixed sigma), on numpy mgrid nodes, plus
  pyrandonaut's exact calculate_kde procedure (openrandonaut/pyrandonaut 0.1.9)
- Kulldorff scan LLR maxima by brute force with quadrature window areas
- global envelope tests (Myllymäki et al. 2017 extreme rank, ERL; MAD) from
  their definitions on synthetic curve matrices with and without ties
- geohash encodings, cell bounds and neighbours from pygeohash
"""

import json
import math
import platform
from pathlib import Path

import numpy as np
import pygeohash as pgh
import scipy
from scipy import integrate, stats

FIXTURES = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, numpy {np.__version__}, scipy {scipy.__version__}, pygeohash"


def mgrid_nodes(lo, hi, g):
    step = (hi - lo) / (g - 1)
    return [i * step + lo for i in range(g)]


def kde_rule(pts, rule, xs, ys):
    kernel = stats.gaussian_kde(pts.T, bw_method=rule)
    gx, gy = np.meshgrid(xs, ys)  # row = y index, column = x index
    values = kernel(np.vstack([gx.ravel(), gy.ravel()]))
    cov = kernel.covariance
    return values.tolist(), [float(cov[0, 0]), float(cov[0, 1]), float(cov[1, 1])]


def kde_sigma(pts, sigma, xs, ys):
    gx, gy = np.meshgrid(xs, ys)
    nodes = np.column_stack([gx.ravel(), gy.ravel()])
    total = np.zeros(len(nodes))
    for p in pts:
        total += stats.multivariate_normal(mean=p, cov=sigma * sigma * np.eye(2)).pdf(nodes)
    return (total / len(pts)).tolist()


def pyrandonaut_kde(pts):
    """calculate_kde from pyrandonaut with x = first coordinate, y = second."""
    kernel = stats.gaussian_kde(np.vstack([pts[:, 0], pts[:, 1]]), bw_method="silverman")
    xmin, xmax = pts[:, 0].min(), pts[:, 0].max()
    ymin, ymax = pts[:, 1].min(), pts[:, 1].max()
    x_val, y_val = np.mgrid[xmin:xmax:100j, ymin:ymax:100j]
    positions = np.vstack([x_val.ravel(), y_val.ravel()])
    k_pos = kernel(positions)
    best = int(np.argmax(k_pos))
    x, y = positions.T[best]
    return {"x": float(x), "y": float(y), "density": float(k_pos[best])}


def kde_cases(field, disk_pts):
    csr = np.array([[p["x"], p["y"]] for p in field["cases"][0]["points"]])
    clustered = np.array([[p["x"], p["y"]] for p in field["cases"][1]["points"]])
    out = []
    for label, pts, region, opts in [
        ("csr200-silverman-region", csr, "rect", {"bandwidth": "silverman", "grid": [25, 20], "extent": "region"}),
        ("clustered210-scott-data", clustered, "rect", {"bandwidth": "scott", "grid": [30, 30], "extent": "data"}),
        ("csr200-sigma-region", csr, "rect", {"bandwidth": 7.5, "grid": [20, 16], "extent": "region"}),
        ("disk150-silverman-region", disk_pts, "disk", {"bandwidth": "silverman", "grid": [21, 21], "extent": "region"}),
    ]:
        gx, gy = opts["grid"]
        if opts["extent"] == "data":
            xs = mgrid_nodes(pts[:, 0].min(), pts[:, 0].max(), gx)
            ys = mgrid_nodes(pts[:, 1].min(), pts[:, 1].max(), gy)
        elif region == "rect":
            xs, ys = mgrid_nodes(0.0, 100.0, gx), mgrid_nodes(0.0, 80.0, gy)
        else:
            xs, ys = mgrid_nodes(-50.0, 50.0, gx), mgrid_nodes(-50.0, 50.0, gy)
        if isinstance(opts["bandwidth"], str):
            values, cov = kde_rule(pts, opts["bandwidth"], xs, ys)
        else:
            values, cov = kde_sigma(pts, opts["bandwidth"], xs, ys), None
        out.append({"label": label, "region": region, "options": opts, "xs": xs, "ys": ys, "values": values, "covariance": cov})
    return out, {"csr200": pyrandonaut_kde(csr), "clustered210": pyrandonaut_kde(clustered)}


# ---------------------------------------------------------------- scan


def circle_rect_area(cx, cy, r, w, h):
    a, b = max(0.0, cx - r), min(w, cx + r)
    if b <= a:
        return 0.0

    def chord(x):
        half = math.sqrt(max(0.0, r * r - (x - cx) ** 2))
        return max(0.0, min(h, cy + half) - max(0.0, cy - half))

    breaks = {a, b}
    for yb in (0.0, h):
        if abs(yb - cy) < r:
            dx = math.sqrt(r * r - (yb - cy) ** 2)
            breaks |= {cx - dx, cx + dx}
    breaks = sorted(p for p in breaks if a <= p <= b)
    return sum(integrate.quad(chord, lo, hi, limit=400, epsabs=1e-13, epsrel=1e-12)[0] for lo, hi in zip(breaks, breaks[1:]))


def scan_llr(pts, w, h, max_fraction=0.5):
    n = len(pts)
    area = w * h
    best = (0.0, None)
    for i, p in enumerate(pts):
        d2 = np.sort(((pts - p) ** 2).sum(axis=1))
        for r2 in np.unique(d2):
            if r2 == 0:
                continue
            radius = math.sqrt(r2)
            clipped = circle_rect_area(p[0], p[1], radius, w, h)
            if clipped > max_fraction * area:
                break
            c = int((d2 <= r2).sum())
            e = n * clipped / area
            if c <= e:
                continue
            llr = c * math.log(c / e) + ((n - c) * math.log((n - c) / (n - e)) if n > c else 0.0)
            if llr > best[0]:
                best = (llr, {"center": {"x": float(p[0]), "y": float(p[1])}, "radius": radius, "count": c, "expected": e})
    return {"llr": best[0], "cluster": best[1]}


# ---------------------------------------------------------------- envelopes


def global_tests(curves, alpha):
    n, d = curves.shape
    below = (curves[None, :, :] <= curves[:, None, :]).sum(axis=1)  # [i, r] = #{j : c_j(r) <= c_i(r)}
    above = (curves[None, :, :] >= curves[:, None, :]).sum(axis=1)
    pointwise = np.minimum(below, above)
    ranks = pointwise.min(axis=1)
    r1 = ranks[0]
    p_minus = (1 + int((ranks[1:] < r1).sum())) / n
    p_plus = int((ranks <= r1).sum()) / n
    vectors = [tuple(sorted(row)) for row in pointwise.tolist()]
    erl = sum(1 for v in vectors if v <= vectors[0]) / n
    k_alpha = 0
    for k in range(1, n + 1):
        if (ranks < k).sum() <= alpha * n + 1e-9:
            k_alpha = k
    lower = upper = None
    if alpha * n >= 1 - 1e-9 and k_alpha >= 1:
        sorted_cols = np.sort(curves, axis=0)
        lower = sorted_cols[k_alpha - 1].tolist()
        upper = sorted_cols[n - k_alpha].tolist()
    mean = curves.mean(axis=0)
    dev = np.abs(curves - mean).max(axis=1)
    return {
        "rank": int(r1),
        "pInterval": [p_minus, p_plus],
        "pErl": erl,
        "lower": lower,
        "upper": upper,
        "madStatistic": float(dev[0]),
        "madP": int((dev >= dev[0]).sum()) / n,
        "pointwiseP": [min(1.0, 2 * int(x) / n) for x in pointwise[0]],
    }


def envelope_cases():
    rng = np.random.default_rng(917)
    ties = rng.integers(0, 12, size=(40, 7)).astype(float)
    ties[0, 3] = 13.0  # observed sticks out at one radius
    smooth = np.cumsum(rng.normal(size=(100, 12)), axis=1)
    smooth[0] += np.linspace(0, 3, 12)
    return [
        {"label": "ties40", "alpha": 0.05, "curves": ties.tolist(), **global_tests(ties, 0.05)},
        {"label": "smooth100", "alpha": 0.1, "curves": smooth.tolist(), **global_tests(smooth, 0.1)},
    ]


# ---------------------------------------------------------------- geohash


def geohash_cases():
    coords = [(57.64911, 10.40744, 11), (42.605, -5.603, 5), (-33.8688, 151.2093, 9), (0.0, 0.0, 6), (89.9, 179.99, 7), (-89.99, -179.99, 4), (48.8566, 2.3522, 12), (40.7128, -74.006, 8)]
    encoded = [{"lat": lat, "lon": lon, "precision": p, "hash": pgh.encode(lat, lon, precision=p)} for lat, lon, p in coords]
    decoded = []
    for h in ["ezs42", "u4pruydqqvj", "s", "9q8yyk8yuv", "zzzz", "0000"]:
        lat, lon, lat_err, lon_err = pgh.decode_exactly(h)
        decoded.append({"hash": h, "lat": lat, "lon": lon, "latError": lat_err, "lonError": lon_err})
    neighbours = []
    for h in ["ezs42", "u4pruydqqvj", "9q8yy", "gbsuv"]:
        n, s, e, w = (pgh.get_adjacent(h, d) for d in ("top", "bottom", "right", "left"))
        neighbours.append({"hash": h, "n": n, "s": s, "e": e, "w": w, "ne": pgh.get_adjacent(n, "right"), "nw": pgh.get_adjacent(n, "left"), "se": pgh.get_adjacent(s, "right"), "sw": pgh.get_adjacent(s, "left")})
    return {"encode": encoded, "decode": decoded, "neighbours": neighbours}


def main():
    field = json.loads((FIXTURES / "field.json").read_text())
    stats_fixture = json.loads((FIXTURES / "stats.json").read_text())
    disk = next(c for c in stats_fixture["cases"] if c["label"] == "disk150")
    disk_pts = np.array([[p["x"], p["y"]] for p in disk["points"]])
    kde, pyrandonaut = kde_cases(field, disk_pts)
    csr = np.array([[p["x"], p["y"]] for p in field["cases"][0]["points"]])
    clustered = np.array([[p["x"], p["y"]] for p in field["cases"][1]["points"]])
    scan_mixed = np.vstack([csr[:45], clustered[:15]])
    scan_csr = csr[100:160]
    scan = []
    for label, pts in (("mixed60", scan_mixed), ("csr60", scan_csr)):
        scan.append({"label": label, "points": [{"x": float(x), "y": float(y)} for x, y in pts], **scan_llr(pts, 100.0, 80.0)})
        print(f"scan {label} done")
    payload = {"generator": GENERATOR, "kde": kde, "pyrandonaut": pyrandonaut, "scan": scan, "envelopes": envelope_cases(), "geohash": geohash_cases()}
    (FIXTURES / "density.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {FIXTURES / 'density.json'}")


if __name__ == "__main__":
    main()
