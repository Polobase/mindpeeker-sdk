# @mindpeeker/rate

## 0.2.0

### Minor Changes

- No API or output changes: the declared Node.js range and the package contents change, and the README's history and parsing notes are corrected.

  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`).
  - The tarball includes `src`, so the published source maps resolve.
  - README: the history of Malcolm Rae's base-44 system now separates claims found in printed sources from claims found only on practitioner web pages (his dates, the rationale for 44, one degree of arc per line, Combe's "base-336" books), and states that Combe's base-336 rates are digit sequences, not base-336 numbers, so `convertBase(rate, 336)` does not produce them.
  - README corrections: `parseRate` accepts `-` or `.` between digits, not spaces (replace the spaces of a printed rate first); `digitToAngle(11, 44)` is within 1 ulp of `Math.PI / 2`, not exactly equal, so compare angles with a tolerance.
