# @mindpeeker/judging

Exact scoring and null distributions for forced-choice and free-response psi
experiments: card and dice guessing, ganzfeld direct hits, remote-viewing rank
matrices, displacement analyses — and the classic statistical traps each of
them has fallen into.

Every p-value here comes from the randomization of the design (targets drawn
uniformly, a shuffled pack, a random pairing of transcripts to targets), never
from an assumption about the person responding: exact binomial tails, the
closed-deck matching distribution in integer arithmetic, Read's optimal
feedback baseline, the n-fold convolution for sums of ranks, permutation counts
over all k! pairings of an SRI judging matrix, Soal/Bartlett pattern-exact
displacement variances, and multiplicity baselines for "best of several looks"
and optional stopping. Zero third-party dependencies (numerics come from
`@mindpeeker/negentropy/numerics`), browser-safe, ESM, deterministic.

> **What these numbers are.** Exact mathematics under a stated design. Whether
> psi exists is a contested hypothesis that this package does not assert,
> test, or support: a small p-value is a fact about calls versus targets under
> the design's null. It becomes evidence for anything only if the design
> really held — targets drawn at random after the response was fixed, blind
> judging, sensory shielding, no feedback that changes the null, and the
> statistic, sample size and scoring rule fixed before the data. No library
> can check those. The history below is the reason to take them seriously.

## Install

```sh
bun add @mindpeeker/judging   # or npm install / pnpm add
```

## Quick start

```ts
import {
  closedDeckTest,
  deflatedCriticalValue,
  directHits,
  expectedMaxOfLooks,
  forcedChoiceBayesFactor,
  forcedChoiceTest,
  optionalStoppingRisk,
  rankMatrixPermutationTest,
  rankOrderStatistic,
  readFeedbackExpectation,
} from '@mindpeeker/judging'

// Ganzfeld: 122 direct hits in 354 sessions, one target among four clips
const g = directHits(122, 354, 4)
g.criticalRatio          // 4.112
g.pOneSided              // 4.44e-5 — exact P(X ≥ 122), Binomial(354, ¼)
g.effectSize             // 0.219 — z/√n
g.rosenthalRubinPi       // 0.612 — hit rate on the two-choice scale (chance ½)
g.confidenceInterval     // { lower: 0.295, upper: 0.397 } — Clopper–Pearson
forcedChoiceBayesFactor(122, 354, { choices: 4, alternative: 'greater' }).bf10 // 221

// A 25-card Zener pack is a shuffled closed deck, not 25 independent draws
closedDeckTest(9, [5, 5, 5, 5, 5]).pOneSided // 0.0504 — exact
forcedChoiceTest(9, 25, 0.2).pOneSided       // 0.0468 — the binomial shortcut crosses 0.05

// With the card shown after every call, chance is 8.65 hits per 25, not 5
readFeedbackExpectation([5, 5, 5, 5, 5]).expected // 8.6468

// Remote viewing: ranks of the true target among 4 (1 = best match)
rankOrderStatistic([1, 2, 1, 3, 1, 4, 2, 1, 2, 1], 4).pExact // 0.0322 — exact sum-of-ranks

// SRI-style 6 × 6 judging matrix, true pairs on the diagonal
rankMatrixPermutationTest([
  [1, 3, 2, 5, 6, 4],
  [2, 1, 4, 3, 5, 6],
  [4, 2, 1, 6, 3, 5],
  [6, 5, 3, 2, 1, 4],
  [3, 6, 5, 1, 2, 3],
  [5, 4, 6, 4, 4, 1],
]).pValue // 2/720 — exact count over all pairings

// Twenty analyses were tried and the best reported
expectedMaxOfLooks(20).exact     // 1.867 — what chance alone gives the best of 20
deflatedCriticalValue(20).z      // 2.799 — what the best of 20 must beat at α = 0.05

// Checking a ganzfeld series after every session from 10 to 200
optionalStoppingRisk(Array.from({ length: 191 }, (_, i) => i + 10), { p0: 0.25 }).risk // 0.215
```

## API

### Forced choice

| Export | What it computes |
| --- | --- |
| `forcedChoiceTest(hits, trials, p0, { confidence? })` | MCE, deviation, SD, critical ratio (and its Rhine–Pratt two-sided normal p), exact one-sided tails $P(X \ge x)$ and $P(X \le x)$, exact two-sided p (minimum-likelihood rule, SciPy `binomtest`), effect size $z/\sqrt n$, Cohen's $h$, Clopper–Pearson interval |
| `directHits(hits, trials, choices, { confidence? })` | the same at $p_0 = 1/k$, plus Rosenthal–Rubin $\pi$ |
| `rosenthalRubinPi(hitRate, choices)` | $\pi = P(k-1)/(1 + P(k-2))$ |
| `forcedChoiceBayesFactor(hits, trials, { p0 \| choices, prior?, alternative? })` | beta-binomial $BF_{10}$ in log space; one-sided alternatives truncate the prior |
| `ESP_RUN`, `PK_RUN` | Rhine's runs: 25 calls at ⅕ (SD 2), 24 throws at ⅙ (SD 1.8257) |
| `runsScore(hits, runs, convention)` | a series of runs; SD = SD<sub>run</sub>·√runs |
| `runsDifference(a, b, convention)` | Rhine–Pratt CR of two conditions, $SD_{run}\sqrt{1/R_A + 1/R_B}$ |

### Closed decks, feedback, information

| Export | What it computes |
| --- | --- |
| `closedDeckMatchDistribution(symbolCounts, callCounts?)` | exact bigint counts and pmf of matches between a call sequence and a shuffled multiset pack; exact mean, variance, and the open-deck variance for comparison (≤ 512 cards) |
| `closedDeckTest(hits, symbolCounts, { callCounts?, runs? })` | exact tails for one run (rational) or several reshuffled runs (convolution), closed vs open-deck critical ratio |
| `compositionProbability(counts)` | multinomial probability that i.i.d. uniform draws give exactly this composition (0.0020917 for 5 × 5) |
| `readFeedbackExpectation(deck)` | Read's optimal strategy with trial-by-trial feedback: expected hits, variance, full pmf |
| `guessingCapacity(hitRate, choices)` | Shannon capacity in bits per trial of the implied symmetric channel |

### Ranks and free response

| Export | What it computes |
| --- | --- |
| `rankOrderStatistic(ranks, choices)` | mean rank, Utts' effect size, exact sum-of-ranks p (both tails), continuity-corrected normal z |
| `sumOfRanksDistribution(trials, choices)` | the exact null pmf of a sum of uniform ranks |
| `consensusRank(judgeRanks)` | rank sums, consensus mid-ranks, tie-corrected Kendall W, Friedman χ² |
| `figureOfMerit(response, target)` | May et al. accuracy × reliability over descriptor memberships |
| `figureOfMeritRank(response, target, decoys)` | the target's rank among its packet; exact $p = \text{rank}/(D+1)$ |
| `rankMatrixPermutationTest(matrix, { better?, targets?, method?, samples?, seed? })` | exact permutation p over all k! pairings (subset DP for integer scores, branch-and-bound for real scores up to k = 10), or seeded Monte Carlo with add-one p |

### Displacement

| Export | What it computes |
| --- | --- |
| `displacementScore(targets, calls, { choices, offsets?, runLength? })` | per-offset exact binomials; pooled hits with the variance conditional on the calls actually made, the naive binomial variance for comparison, the exact pooled tail, and the pattern table (AAA, AAB, ABC …) |
| `displacementMatrix(hits)` | Carington's diagonal expectations $E_d = \sum_{c-o=d} R_o C_c/T$ and $(O_d - E_d)/\sqrt{E_d}$ |

### Multiplicity and optional stopping

| Export | What it computes |
| --- | --- |
| `expectedMaxOfLooks(I)` | $E[\max_{i \le I} Z_i]$ by quadrature, the Bailey–López de Prado approximation, the bound $\sqrt{2\ln I}$ |
| `expectedMaxOfPmf(pmf, looks, offset?)` | expected best of k independent looks at any discrete score (6.740 for three looks at a Zener run) |
| `deflatedCriticalValue(I, { alpha?, sided? })` | Šidák critical z for the best of I independent looks, and Bonferroni's |
| `maxOfLooksPValue(z, I, { sided? })` | family-wise p of the best look, $1 - (1-p_1)^I$ |
| `optionalStoppingRisk(looks, { p0, alpha? })` | exact probability that a fixed-level exact binomial test rejects a true null at some registered look |

### Errors and limits

Every thrown error is a `JudgingError` with a stable `code`:

| Code | Meaning |
| --- | --- |
| `invalid_input` | counts, ranks, symbols, matrices or memberships that cannot be scored |
| `invalid_options` | a bad option: `choices < 2`, `p0` outside (0, 1), an unknown label, a malformed seed |
| `too_large` | an exact computation beyond its documented limit (`MAX_CLOSED_DECK_CARDS`, `MAX_CLOSED_DECK_RUN_CARDS`, `MAX_FEEDBACK_STATES`, `MAX_FEEDBACK_CELLS`, `MAX_SUM_OF_RANKS_WORK`, `MAX_ENUMERATION_SIZE`, `MAX_SUBSET_DP_CELLS`, `MAX_DISPLACEMENT_WORK`, `MAX_OPTIONAL_STOPPING_WORK`) |
| `numerical` | a special function in negentropy's numerics failed (`cause` holds the original; please report) |

`err.argument` names the offending argument or option path.

## Formulas

**Closed decks.** With calls of composition $c$ and a shuffled pack of
composition $t$ ($N$ cards), label the cards: the positions where a call can
match form one complete $c_s \times t_s$ board per symbol, with rook numbers
$r^{(s)}_j = \binom{c_s}{j}\binom{t_s}{j}j!$. The product of these rook
polynomials gives $r_j$ for the whole board, and inclusion–exclusion gives the
number of labelled orders with exactly $k$ matches,
$L_k = \sum_{j \ge k}(-1)^{j-k}\binom{j}{k} r_j (N-j)!$. Dividing by
$\prod_s t_s!$ counts distinct packs. The sum alternates, so it is done in
bigints. For the Zener pack: 623 360 743 125 120 orders, mean 5, variance 25/6
(SD 2.0412, not the binomial 2), $P(24) = 0$, $P(25) = 1.604 \times 10^{-15}$
(Epstein's Table 11-1).

**Read's feedback baseline.** With remaining counts $c$, calling a most
frequent symbol is optimal, and
$E(c) = \max_j c_j/\sum c + \sum_j (c_j/\sum c)\,E(c - e_j)$ with $E(0) = 0$.

**Sum of ranks.** $S = \sum_i R_i$ with $R_i$ uniform on $1…k$ has the
$n$-fold convolution of the discrete uniform as its exact null (Solfvin, Kelly
& Burdick 1978), mean $n(k+1)/2$ and variance $n(k^2-1)/12$. Utts' per-trial
effect size is $((k+1)/2 - \bar r)/\sqrt{(k^2-1)/12}$.

**Rank matrices.** For a $k \times k$ matrix $m_{ij}$ (transcript $i$ scored
against target $j$) and true pairs on the diagonal,
$p = \lvert\{\pi : \sum_i m_{i\pi(i)} \text{ at least as good as } \sum_i m_{ii}\}\rvert/k!$.
The judge's rows need not be independent: only the pairing is random.

**Displacement.** With targets i.i.d. uniform on $m$ symbols, target $t$ is
compared with the calls $\{g_{t-d}\}$. If a symbol $s$ appears $\mu_t(s)$
times among them, the hits on that target are $X_t = \mu_t(T_t)$, so
$\mathrm{Var}\, X_t = \sum_s \mu_t(s)^2/m - (\sum_s \mu_t(s)/m)^2$. For
$m = 5$ that is 36/25 for AAA, 16/25 for AAB, 6/25 for ABC, and 16/25 and
6/25 for the pairs at run ends. Soal's Table I weights (41, 818, 981, 39,
121) give 872.00, where the binomial formula $73 \cdot 4N/25$ gives 934.4.

**Expected maximum.** $E_I = \int_0^\infty (1 - \Phi^I)\,dx - \int_{-\infty}^0 \Phi^I\,dx$;
$E_2 = 1/\sqrt\pi$, $E_3 = 3/(2\sqrt\pi)$. The approximation
$(1-\gamma)\Phi^{-1}(1-1/I) + \gamma\Phi^{-1}(1 - 1/(Ie))$ is about 2 % high at
$I = 10$.

**Optional stopping.** By the law of the iterated logarithm,
$\limsup_n (S_n - np)/\sqrt{2np(1-p)\ln\ln n} = 1$ almost surely. A fixed
critical ratio is therefore crossed eventually with probability 1 if trials
may be added until it is. `optionalStoppingRisk` computes the exact damage for
a finite set of looks. A Bayes factor with a fixed prior
(`forcedChoiceBayesFactor`) is a test martingale and tolerates continuous
monitoring. So do psi's `coinEProcess` and negentropy's anytime-valid
functions.

## Classic critiques this package encodes

Each of these was a real controversy. The API makes the correct null the
default and the old error something you can compute.

- **Closed decks are not binomial** (Greville 1941; Epstein 2009, ch. 11). Treating
  a shuffled Zener pack as Binomial(25, ⅕) understates the SD (2.000 vs
  2.0412) and inflates critical ratios by about 2 %: `closedDeckTest` reports
  both ratios.
- **Feedback changes chance.** A guesser who sees each card afterwards can
  expect 8.65 hits per pack with no psi at all (Read 1962).
  Honorton & Ferrari's forced-choice meta-analysis found trial-by-trial
  feedback among the moderators: `readFeedbackExpectation`.
- **Choosing the displacement afterwards.** The best of offsets −1/0/+1 has
  expectation 6.74 per Zener run, not 5 (Epstein): `expectedMaxOfPmf`.
  Pooled displacement scores need the pattern-exact variance (Bartlett's
  objection to Soal): `displacementScore`. Soal's own results were later shown
  to have been manipulated (Markwick 1978). The package encodes his design and
  its null, not his data.
- **Optional stopping.** Stopping a series "when it looks good" guarantees
  eventual significance (the law of the iterated logarithm; Epstein's
  "optional stopping"): `optionalStoppingRisk`.
- **Many analyses, one reported.** The best of I independent z-scores
  averages $E_I$ even under the null (Bailey & López de Prado's deflated
  threshold): `expectedMaxOfLooks`, `deflatedCriticalValue`.
- **Direct hits or ranks — decide first.** Ganzfeld studies can be scored by
  direct hits or by sum of ranks (Bem & Honorton 1994; Milton 1997). Reporting
  whichever looks better is another multiplicity error. Both scorers are here,
  and the registration has to pick one.
- **Judging depends on the transcripts, not on independence.** The SRI rank
  matrix test is exact under random pairing whatever the judge does
  (`rankMatrixPermutationTest`). Critics (Marks & Kammann 1978 on cues in
  unedited transcripts; Hyman 1996 on the SRI/SAIC programme) targeted the
  design, not the arithmetic.
- **Die bias.** Dice targets must rotate over all faces, or face bias alone
  produces hits (Radin & Ferrari 1991). `PK_RUN` assumes a counterbalanced
  design.

Fisher's 1924 graded scoring of playing-card coincidences (−log₁₀ of the
probability of an attribute match or better, standardized to mean 0 and
SD 10) is implemented in `@mindpeeker/coincidence` (`fisherMatchScore` with
`PLAYING_CARD_SCHEME`), not duplicated here.

## How the numbers are verified

`scripts/fixtures/generate.py` (run with `uv run`) writes
`test/fixtures/judging.json`. It shares no code path with the TypeScript:

- exact integer arithmetic for binomial tails and the two-sided rule
  (cross-checked against SciPy `binomtest`);
- a DP over contingency tables for closed decks, where the package uses rook
  polynomials;
- `fractions.Fraction` recursions for Read's baseline and optional stopping;
- integer convolutions for sums of ranks;
- `itertools.permutations` for rank matrices;
- brute-force enumeration of every target sequence for displacement nulls;
- mpmath (50 digits) for Bayes factors, capacities and the expected maximum
  (density-form quadrature).

The tests also enumerate small cases in bigint arithmetic directly and check
the closed forms: rencontres → e⁻¹, $E_2 = 1/\sqrt\pi$, the Greville moments,
and Soal's pattern variances. Published values checked: Epstein's Zener
table, SD 2.041, 8.647, 6.740, 0.00209 and the capacities 0.0069/0.026; the
Rhine–Pratt placement example (SD 12.25, CR −2.6), Tyrrell's CR 4.96 and the
autoganzfeld CR 4.11. The Bayes factor also agrees with psi's
`binomialLogBayesFactor` to 2e-13.

## What this package will not tell you

- Whether targets were really random, the judge really blind, or the
  transcripts free of cues. Those are the conditions every null above relies
  on.
- Whether a descriptor coding was done before the target was known. The
  figure of merit trusts its inputs.
- What an effect means. A capacity of 0.026 bits per call is a measure of
  size. It is not a mechanism.

## Sources

- Rhine, J. B. & Pratt, J. G. (1957). *Parapsychology: Frontier Science of the Mind*. Thomas.
- Epstein, R. A. (2009). *The Theory of Gambling and Statistical Logic*, 2nd ed., ch. 11 (paranormal phenomena). Academic Press.
- Greville, T. N. E. (1941). The frequency distribution of a general matching problem. *Annals of Mathematical Statistics* 12, 350–354.
- Read, R. C. (1962). Card-guessing with information — a problem in probability. *American Mathematical Monthly* 69, 506–511.
- Diaconis, P. & Graham, R. (1981). The analysis of sequential experiments with feedback to subjects. *Annals of Statistics* 9, 3–23.
- Solfvin, G. F., Kelly, E. F. & Burdick, D. S. (1978). Some new methods of analysis for preferential-ranking data. *Journal of the American Society for Psychical Research* 72, 93–110.
- Utts, J. (1991). Replication and meta-analysis in parapsychology. *Statistical Science* 6, 363–403.
- Utts, J. (1996). An assessment of the evidence for psychic functioning. *Journal of Scientific Exploration* 10, 3–30; Hyman, R. (1996), response, same issue.
- May, E. C., Utts, J. M., Humphrey, B. S., Luke, W. L. W., Frivold, T. J. & Trask, V. V. (1990). Advances in remote-viewing analysis. *Journal of Parapsychology* 54, 193–228.
- Bem, D. J. & Honorton, C. (1994). Does psi exist? *Psychological Bulletin* 115, 4–18; Milton, J. (1997), *Journal of Parapsychology* 61.
- Storm, L., Tressoldi, P. & Di Risio, L. (2010). Meta-analysis of free-response studies 1992–2008. *Psychological Bulletin* 136, 471–485.
- Rosenthal, R. & Rubin, D. B. (1989). Effect size estimation for one-sample multiple-choice-type data. *Psychological Bulletin* 106, 332–337.
- Soal, S. G. & Goldney, K. M. (1943). Experiments in precognitive telepathy. *Proceedings of the Society for Psychical Research*; Soal's reply to Bartlett on pooled-displacement variance, *Proc. SPR* 48; Markwick, B. (1978). The Soal–Goldney experiments with Basil Shackleton: new evidence of data manipulation. *Proc. SPR* 56.
- Carington, W. (1940). Experiments on the paranormal cognition of drawings. *Proc. SPR* 46.
- SRI International remote-viewing programme report, declassified as CIA-RDP96-00787R000100060001-6 (evaluation procedure: blind 6 × 6 rank matrices, exact direct count of permutations); Marks, D. & Kammann, R. (1978). Information transmission in remote viewing experiments. *Nature* 274, 680–681.
- Radin, D. I. & Ferrari, D. C. (1991). Effects of consciousness on the fall of dice. *Journal of Scientific Exploration* 5, 61–83.
- Honorton, C. & Ferrari, D. C. (1989). "Future telling": a meta-analysis of forced-choice precognition experiments. *Journal of Parapsychology* 53, 281–308.
- Bailey, D. H. & López de Prado, M. (2014). The deflated Sharpe ratio. *Journal of Portfolio Management* 40(5); López de Prado, M. (2018), *Advances in Financial Machine Learning*.
- Šidák, Z. (1967). Rectangular confidence regions for the means of multivariate normal distributions. *JASA* 62, 626–633.
- Robbins, H. (1952). Some aspects of the sequential design of experiments. *Bull. AMS* 58, 527–535; Shafer, G. et al. (2011), Test martingales, Bayes factors and p-values, *Statistical Science* 26, 84–101.
- Clopper, C. J. & Pearson, E. S. (1934). The use of confidence or fiducial limits illustrated in the case of the binomial. *Biometrika* 26, 404–413.
- Riordan, J. (1958). *An Introduction to Combinatorial Analysis*, ch. 7–8 (rook polynomials). Wiley.

## Behaviour changes in 0.2.0

- New package.

## Development

```sh
bun test packages/judging
cd packages/judging && bun run typecheck && bun run build
uv run packages/judging/scripts/fixtures/generate.py   # regenerate reference values
```
