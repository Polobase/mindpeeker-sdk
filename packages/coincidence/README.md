# @mindpeeker/coincidence

Exact probabilities of coincidences — the denominator a surprising match
needs before anyone reads meaning into it.

Two words with the same gematria value, the same hexagram twice in a week, a
burst of 23s in a synchronicity log, a cluster of field hits: each feels
improbable when looked at alone. This package computes how often chance alone
produces such a coincidence: the birthday problem and its generalisations
(unequal categories, k-fold and near matches, several attributes at once), the
Diaconis–Mosteller approximations next to the exact numbers, the law of truly
large numbers, Fisher's 1924 graded-match scores, and an exact clustering test
for event timestamps. Zero dependencies, browser-safe, ESM, deterministic.

> **What these numbers are.** They are exact probabilities (up to
> floating-point rounding, stated per function) under explicit null models:
> independent draws, stated category probabilities, uniform event times. They
> say how cheap a coincidence is. They are **not** evidence for or against
> synchronicity, seriality or any other meaning. A small probability shows
> that chance under *that* model rarely produces the observation. It does not
> show that something else did, and it means little if the match was chosen
> after the data were seen.

## Install

```sh
bun add @mindpeeker/coincidence   # or npm install / pnpm add
```

## Quick start

```ts
import {
  birthdayMatch,
  kWayMatch,
  multiCategory,
  nearMatch,
  noMatchNonUniform,
  peopleForMatch,
  probabilityAtLeastOne,
  seriesClustering,
} from '@mindpeeker/coincidence'

birthdayMatch(23, 365)              // 0.5072972343239854 — the classic 23 people
peopleForMatch(0.5, 365)            // 23
kWayMatch(88, 365, 3)               // 0.5111 — three people sharing a birthday
nearMatch(14, 365, 1)               // 0.5375 — two birthdays within a day
multiCategory([365, 1000, 500]).peopleExact // 16 — a match in any of three attributes
birthdayMatch(10, 64)               // 0.5232 — a repeated hexagram in ten I Ching casts
probabilityAtLeastOne(1e7, 1e-6)    // 0.99995 — "one in a million", ten million chances

// unequal categories always raise the match probability
noMatchNonUniform(3, [0.5, 0.25, 0.125, 0.125]).match // 0.7421875 (equal: 0.625)

// did events cluster in time? 7 logged events over 30 days, one-day windows
const log = seriesClustering([1.1, 1.2, 1.3, 1.4, 1.5, 10.5, 20.5], { window: 1, span: 30 })
log.maxCount // 5 events on one day
log.pValue   // 2.45e-5 — exact P(some day holds ≥ 5 of 7 uniform events)
```

With [`@mindpeeker/gematria`](../gematria) installed, the value histogram of a
lexicon is the category distribution:

```ts
import { collisionProfile } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'
import { birthdayMatch, noMatchNonUniform } from '@mindpeeker/coincidence'

const profile = collisionProfile(defaultLexicon('he-hechrachi'), 'he-hechrachi')
const probs = profile.histogram.map((bin) => bin.probability) // 115 values over 160 words

noMatchNonUniform(10, probs).match   // 0.3845 — two of ten random words share a value
birthdayMatch(10, profile.distinct)  // 0.3314 — if the 115 values were equally likely
```

## API

Every function validates its arguments first and throws
`CoincidenceError('invalid_input')` naming the argument. Counts are safe
integers; probabilities are numbers in [0, 1].

### The birthday problem

n independent draws from c equally likely categories (Diaconis & Mosteller
1989, Problem 1).

| export | returns |
|---|---|
| `birthdayNoMatch(n, c)` | exact $P(\text{all different}) = \prod_{i<n}(1 - i/c) = c!/((c-n)!\,c^n)$ |
| `birthdayMatch(n, c)` | exact $1 - \prod_{i<n}(1 - i/c)$ |
| `birthdayApprox(n, c)` | $\exp(-n(n-1)/2c)$, the pair-count approximation of **no match** (D–M eq. 7.2 writes $N^2$) |
| `peopleForMatch(p, c)` | smallest n with `birthdayMatch(n, c) ≥ p` (exact bisection; c + 1 for p = 1) |
| `peopleForMatchApprox(p, c)` | $\sqrt{2c\ln(1/(1-p))}$: $1.1774\sqrt c$ at ½ and $2.4477\sqrt c$ at 0.95, which D–M round to 1.2√c and 2.5√c (eqs. 7.3–7.4) |

The products are summed in log space: `log1p` terms up to 2048 draws, and
beyond that Stirling's series arranged as
$c\,\varphi(a/c) - c\,\varphi(b/c) - \tfrac12\ln(1-m/a) + \delta(a) - \delta(b)$,
with $\varphi(x) = x\ln x - (x - 1)$, so the large cancelling terms never meet.
The match probability is formed as $-\mathrm{expm1}(\ln P)$. Both tails keep
full relative precision from $c = 1$ up to $c = 2^{53} - 1$. The leading-order
bound is the same one `@mindpeeker/gematria`'s `birthdayBound` uses (22.49 at
c = 365).

### Unequal categories

| export | returns |
|---|---|
| `collisionProbability(probs)` | $q = \sum_i p_i^2$, the chance that two draws coincide ($1/q$ is the effective number of categories) |
| `probabilitiesFromCounts(counts)` | a histogram normalized to probabilities |
| `noMatchNonUniform(n, probs, { method })` | `{ noMatch, match, method }` |
| `NONUNIFORM_EXACT_LIMIT` | $10^8$ (about a second): the largest n × (categories with p > 0) handled exactly |

The exact method is $P(\text{no match}) = n!\,e_n(p_1, \dots, p_c)$, the
elementary symmetric polynomial, computed by an O(n·c) recursion over the
categories. After t categories it holds $F_j$ = P(j draws all different | all
land among the first t) and $G_j = 1 - F_j$. Adding a category with
conditional share β (α = 1 − β) gives
$F_j \leftarrow \alpha^j F_j + j\beta\alpha^{j-1}F_{j-1}$ and
$G_j \leftarrow \alpha^j G_j + j\beta\alpha^{j-1}G_{j-1} + P(\mathrm{Bin}(j,\beta) \ge 2)$.
Every step is a convex combination of non-negative terms, so nothing
underflows and gets amplified later, and a tiny match probability is not lost
to $1 - P$. Beyond the limit, `method: 'auto'` (default) switches to
the second-order expansion
$$\ln P \approx -\tbinom n2 S_2 + 2\tbinom n3 S_3 - \tfrac{n(n-1)(2n-3)}4 S_2^2,\qquad S_k = \sum_i p_i^k,$$
which is accurate while $n \max_i p_i \ll 1$ (its error is $O(n^4/c^3)$ in
$\ln P$ for equal categories). `'poisson'` keeps only the first term;
`'exact'` throws `too_large` beyond the limit. `method` always says which
one ran.

**The non-uniformity lemma.** Replacing two probabilities x, y by their mean
raises $P(\text{all different})$ by exactly
$n!\,\tfrac{(x-y)^2}4\,e_{n-2}(\text{rest}) \ge 0$. Equal categories therefore
*minimise* the match probability, and every unevenness makes coincidences
cheaper (Haigh 1999). The tests check this identity in exact
rational arithmetic on random vectors.

### k-fold matches

The chance that some category receives **at least k** of n draws (D–M
Problem 3). `categories` is a count of equally likely categories or a
probability vector.

| export | returns |
|---|---|
| `kWayProbabilities(n, categories, k)` | `{ match, noMatch, method: 'dp' \| 'levin' }` |
| `kWayMatch(n, categories, k)` / `kWayNoMatch(…)` | the two probabilities |
| `peopleForKWayMatch(p, categories, k)` | smallest n with `kWayMatch ≥ p` |
| `kWayMatchApprox(n, c, k)` | $1 - \exp\bigl(-n^k e^{-n/c} / (c^{k-1}k!\,(1 - n/(c(k+1))))\bigr)$ |
| `peopleForKWayMatchApprox(p, c, k)` | the root N of D–M eq. 7.5, $N e^{-N/ck}(1 - N/(c(k+1)))^{-1/k} = (c^{k-1}k!\ln\frac1{1-p})^{1/k}$ |
| `KWAY_WORK_LIMIT` | work budget of one exact evaluation (about two seconds) |

Two exact algorithms, chosen by cost:

- **`dp`**: condition on one category at a time. With m draws left for
  categories i … B, category i receives $J \sim \mathrm{Binomial}(m, q_i)$
  with $q_i = p_i / (p_i + \dots + p_B)$, and the no-match and match
  probabilities recurse over non-negative terms, so both keep full relative
  precision. The cost is about categories × n × k.
- **`levin`**: Levin's (1981) representation
  $P(\text{no match}) = \frac{n!\,e^s}{s^n}\prod_i P(Y_i < k)\,P(W = n)$ with
  $Y_i \sim \mathrm{Poisson}(s p_i)$ and W a sum of truncated Poissons, built
  by repeated squaring (s = n). The cost is about $n^2 \log_2 c$ for c equal
  categories, so it handles $c = 10^6$. Rounding compounds with c: `noMatch`
  has relative error about $c \cdot 10^{-16}$ ($1.2 \cdot 10^{-10}$ at
  $c = 10^6$), and `match = 1 − noMatch` carries it as absolute error.

When neither fits the budget, it throws `too_large`; use `kWayMatchApprox`.
The exact values reproduce Levin's table in D–M (Table 3) for c = 365:

| k | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| least N with P > ½ | 23 | 88 | 187 | 313 | 460 | 623 | 798 | 985 | 1181 | 1385 | 1596 | 1813 |

D–M fit these with $N \approx 47(k - 1.5)^{3/2}$, which is within 3 % for
3 ≤ k ≤ 13 (a curve fit, not a formula). For their day-of-month example
(c = 30, k = 3, p = ½), eq. 7.5 gives 17.96 and the exact answer is 18.

### Near matches

Two of n uniform points among c positions lie within distance d (D–M
Problem 4). `options.topology` is `'circle'` (default; calendar days wrap) or
`'line'`.

| export | returns |
|---|---|
| `nearNoMatch(n, c, d, options?)` | circle (Abramson & Moser 1970): $\frac{(c-nd-1)!}{(c-n(d+1))!\,c^{n-1}}$; line: $\frac{(c-(n-1)d)!}{(c-(n-1)d-n)!\,c^n}$ |
| `nearMatch(n, c, d, options?)` | the complement |
| `peopleForNearMatch(p, c, d, options?)` | smallest n with `nearMatch ≥ p`: 14 for d = 1, 7 for d = 7 (c = 365) |
| `peopleForNearMatchApprox(p, c, d)` | $\sqrt{2\ln(1/(1-p))\,c/(2d+1)}$ (D–M eq. 7.6, after Sevast'yanov 1972) |

The fixture generator checks both closed forms against brute-force
enumeration before they produce any reference value.

### Several attributes

People compare birthdays, towns and first names. A match in any attribute
counts (D–M Problem 2).

| export | returns |
|---|---|
| `multiCategoryNoMatch(n, cs)` | exact $\prod_a \prod_{i<n}(1 - i/c_a)$ (the attributes are independent, so the no-match events are too) |
| `multiCategoryMatch(n, cs)` | the complement |
| `multiCategory(cs, { p })` | `{ harmonicMean, effectiveCategories, peopleApprox, peopleExact, … }` |

The Diaconis–Mosteller rule: the attributes act like one with
$1/\sum_a 1/c_a = H/k$ values (H the harmonic mean), so about
$1.2\sqrt{H/k}$ people give an even chance. Their example (365 birthdays,
1000 lottery tickets, 500 theatre nights) needs 16 people. `peopleApprox`
gives 15.5 with the unrounded multiplier, and `peopleExact` gives 16.

### The law of truly large numbers

| export | returns |
|---|---|
| `expectedCoincidences(opportunities, p)` | $N p$ (no independence needed) |
| `probabilityAtLeastOne(opportunities, p)` | $1 - (1-p)^N$ via $-\mathrm{expm1}(N\,\mathrm{log1p}(-p))$ (independent opportunities) |

"With a large enough sample, any outrageous thing is likely to happen"
(Diaconis & Mosteller 1989). Littlewood's "law of miracles" is the same
arithmetic with illustrative inputs. Suppose you notice one event per second
for eight waking hours a day, and call a one-in-a-million event a miracle.
Then 35 days hold 1,008,000 events: `expectedCoincidences(1_008_000, 1e-6)`
≈ 1.008 miracles a month. Littlewood (1953) took one in a million as the
threshold for surprise, which D–M cite; the name "law of miracles" is Dyson's
(2004). The inputs are invented, not measured, and the package ships no
constant for them.

### Fisher's graded-match scores

Fisher (1924) scored partial agreement between a called and a drawn card:
$-\log_{10} P(\text{this grade or better})$ per attribute, summed over
independent attributes, then standardized to mean 0 and SD 10.

| export | returns |
|---|---|
| `fisherScheme(attributes)` | a validated scheme with per-grade scores and the exact null mean and SD |
| `fisherMatchScore(scheme, observed)` | `{ grades, raw, score, tailProbability }`; `observed` gives one grade (label or index) per attribute |
| `fisherSeries(scheme, observations)` | `{ n, total, meanScore, standardError: 10/√n, z, exceedsTwoStandardErrors }` |
| `PLAYING_CARD_SCHEME` | suit O ½ / C ¼ / S ¼ × value O 60/169 / R 96/169 / N 13/169 |
| `playingCardGrades(a, b)` | grade labels for two `{ suit, rank }` cards (jack of hearts vs queen of diamonds → `['C', 'R']`) |
| `fisherClosenessScore(d, c)` | $-\log_{10}((1 + 2d)/c)$ for circular distance d (D–M §6, birthdays and deathdays) |

`PLAYING_CARD_SCHEME` reproduces Fisher's printed scores to the last decimal:

| suit \ value | O | R | N |
|---|---|---|---|
| **O** | −11.18 | −6.11 | +18.50 |
| **C** | −3.16 | +1.91 | +26.53 |
| **S** | +4.86 | +9.94 | +34.55 |

The null mean of the raw score is 0.41965086 and its SD 0.37519232. The tests
also enumerate all 52 × 52 card pairs. Fisher judged a series unremarkable
unless its mean score exceeds twice its standard error. `z` is reported, but
no p-value is claimed, because the score distribution is discrete. Caveats:
the null assumes both cards are random, and a guesser's calls are not (Fisher
1928 conditioned on the call; D–M §6). His worked example of 49 draws is
internally inconsistent as printed: the listed counts give a total of −23.21,
while the page prints −31.21. The conclusion (chance) holds either way.

### Seriality: clustering in time

Paul Kammerer's *Das Gesetz der Serie* (1919) defined a series as the
recurrence or clustering, in time or space, of the same or similar things
that no common active cause connects. He classified series by *order*
(successive coincidences), *power* (parallel coincidences) and *parameters*
(shared attributes), as summarised in Koestler, *The Roots of Coincidence*.
Kammerer offered a taxonomy, not a test. Chance alone clusters, and a Poisson
process has runs. `seriesClustering` prices a logged series against exactly
that null.

```ts
import { seriesClustering } from '@mindpeeker/coincidence'

// timestamps in days; one-day windows from the start of a 30-day log
const result = seriesClustering([1.1, 1.2, 1.3, 1.4, 1.5, 10.5, 20.5], { window: 1, span: 30 })
result.counts         // events per window
result.maxCount       // 5 — the scan statistic on this grid
result.pValue         // exact P(some window ≥ 5) under the null
result.dispersion     // Pearson X² = 108.7 with exact null mean 29, variance 49.7 (z = 11.3)
```

| option | meaning |
|---|---|
| `window` | window width (same unit as the timestamps); windows tile the span from its start, the last may be shorter |
| `span` | `{ start, end }`, or a number for `[0, span]`; every timestamp must lie inside |
| `rate` | optional **pre-specified** rate. Without it the null conditions on the observed count n (uniform times, multinomial window counts, exact via the k-fold engine). With it, window counts are independent Poisson(rate · length) and $P(M \ge m) = 1 - \prod_i P(X_i < m)$ |

The dispersion $X^2 = \sum_i (x_i - e_i)^2/e_i$ comes with its exact null
mean and variance: $B - 1$ and $2(B-1) + (\sum_i 1/p_i - B^2 - 2B + 2)/n$
under the conditional null (Haldane 1937), and $B$ and $\sum_i (2 + 1/e_i)$
under the Poisson null. There is no p-value for it, because the χ²
approximation fails for the small expected counts typical of coincidence
logs.

**Fix the grid before looking.** The origin and width of the windows are part
of the hypothesis. Trying several widths or offsets and reporting the best
is a multiple comparison this function cannot see. A sliding-window scan
statistic has a different null, which is not implemented.

### Errors

`CoincidenceError` has `name`, a stable `code` and, where it applies, the
offending `argument` and a `cause`.

| code | when |
|---|---|
| `invalid_input` | an argument or option outside its documented domain; nothing is computed |
| `too_large` | an exact computation beyond its work limit (`KWAY_WORK_LIMIT`, `NONUNIFORM_EXACT_LIMIT`, `MAX_WINDOWS`); the message names the approximation |

## How the numbers are verified

- **Independent references.** `scripts/fixtures/generate.py` and
  `kway_series.py` (run with `uv run`) produce the checked-in fixtures. They
  use exact fractions, 60-digit mpmath and exact big-integer counts of maps
  with bounded fibres (a power-of-a-polynomial recurrence that shares no code
  with the TypeScript). Each closed form is first checked against brute-force
  enumeration.
- **BigInt enumeration in the tests.** Small cases (every assignment of 3 to
  7 draws, depending on the function) are enumerated exhaustively for the
  birthday, k-fold, near-match, several-attribute and seriality functions.
  The non-uniformity lemma is checked in exact rationals.
- **Published values.** The tests pin Levin's Table 3, Abramson & Moser's 14,
  the D–M examples (16 people, N ≈ 18), Fisher's nine scores, and the
  birthday figures in Haigh and Mlodinow (0.5243/0.4927, 0.1304, about 5 %
  and about 28 %). A popular "0.85 for 35 people" is wrong: it is 0.814.
- **Calibration.** Over 3000 seeded null logs (20 uniform events, 30
  windows), the conditional p-value of `seriesClustering` rejects 1.0 % at
  α = 0.05; the exact discrete test is conservative, never liberal.

## What this package will not tell you

Whether a coincidence *means* anything. Every probability here is computed
under a stated model, and real data break models: birthdays are not uniform,
events are not independent, a lexicon is not a random sample of words. The
most common error is not in the arithmetic but in the choice of what counts as
a match. That choice is often made after the match was noticed, which is
exactly the multiplicity the law of truly large numbers describes. Jung's
marriage-horoscope study is the cautionary example: its maxima were post-hoc,
and they cancelled when the batches were split. Pre-register what counts as a
coincidence, then use these functions for the denominator.

## Sources

- P. Diaconis and F. Mosteller (1989), "Methods for Studying Coincidences",
  *Journal of the American Statistical Association* 84(408), 853–861:
  eqs. 7.1–7.6, Tables 2–3, the law of truly large numbers.
- B. Levin (1981), "A Representation for Multinomial Cumulative Distribution
  Functions", *Annals of Statistics* 9, 1123–1126.
- M. Abramson and W. O. J. Moser (1970), "More Birthday Surprises",
  *American Mathematical Monthly* 77, 856–858.
- B. A. Sevast'yanov (1972), "Poisson Limit Law for a Scheme of Sums of
  Dependent Random Variables", *Theory of Probability and Its Applications*
  17, 695–699.
- R. A. Fisher (1924), "A Method of Scoring Coincidences in Tests with
  Playing Cards", *Proceedings of the Society for Psychical Research* 34,
  181–185 (public domain in the US). The scores are recomputed from first
  principles, and no text is reproduced.
- J. B. S. Haldane (1937), "The Exact Value of the Moments of the
  Distribution of χ², Used as a Test of Goodness of Fit, When Expectations Are
  Small", *Biometrika* 29, 133–143.
- P. Kammerer (1919), *Das Gesetz der Serie* (public domain); summarised in A.
  Koestler (1972), *The Roots of Coincidence*, ch. III.
- J. Haigh (1999), *Taking Chances: Winning with Probability*, Oxford
  University Press: the birthday derivation, the non-uniformity argument, the
  class-size and number-plate figures.
- L. Mlodinow (2008), *The Drunkard's Walk*: the lottery-repeat figures.
- J. E. Littlewood (1953), *A Mathematician's Miscellany*; F. Dyson (2004),
  "One in a Million", *New York Review of Books*.

## Behaviour changes in 0.2.0

- New package.

## Development

```sh
bun test                                     # fixtures are checked in — no Python needed
bun run typecheck
uv run scripts/fixtures/generate.py          # numerics, birthday, near, multi, non-uniform, Fisher
uv run scripts/fixtures/kway_series.py       # k-fold matches and seriesClustering
bunx biome check --write test/fixtures       # the checked-in JSON is Biome-formatted
```
