# @mindpeeker/flow

Transfer entropy and information dynamics for discrete symbol streams.

Where [`@mindpeeker/entropy`](../entropy) sources randomness and
[`@mindpeeker/negentropy`](../negentropy) asks whether one stream contains
order, flow asks a directional question about **two** streams:

> How many bits does the past of $X$ tell me about the next symbol of $Y$,
> beyond what $Y$'s own past already tells me?

Browser-safe (only `Math` and typed arrays), ESM. One workspace dependency:
[`@mindpeeker/negentropy/numerics`](../negentropy) for the fixture-validated
χ² tail and compensated summation — nothing else. Everything operates on
integer symbol arrays (`Uint8Array`, `ArrayLike<number>`); adapters turn
bytes and continuous measurements into symbols. Every `@mindpeeker/entropy`
provider works as a live input *structurally* — the packages share a shape,
not code:

```ts no-check
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

## Quick start

```ts
import {
  chiSquareTest,
  effectiveTransferEntropy,
  netTransferEntropy,
  permutationTest,
  quantileBins,
  transferEntropy,
  transferEntropyReport,
  xoshiro128ss,
} from '@mindpeeker/flow'

const rng = xoshiro128ss(7) // seeded demo data: y copies x's previous bit
const x = Int32Array.from({ length: 2000 }, () => (rng() < 0.5 ? 1 : 0))
const y = Int32Array.from(x, (_, i) => (i > 0 ? (x[i - 1] as number) : 0))

// two aligned integer symbol series (any non-negative alphabet)
const te = transferEntropy(x, y, { k: 1, l: 1 }) // TE X→Y in bits
const net = netTransferEntropy(x, y) // TE X→Y − TE Y→X

// finite samples ALWAYS give positive TE — never read a raw value without a null:
const { p, z, distinct } = permutationTest(x, y, { surrogates: 199, seed: 42 })
const { ete } = effectiveTransferEntropy(x, y, { surrogates: 20, seed: 42 })
const { p: pChi, adequate } = chiSquareTest(x, y) // asymptotic; trust only when adequate

// everything at once, with the configuration echoed for the record
const report = transferEntropyReport(x, y, { surrogate: 'circularShift', seed: 42 })

// continuous data? bin it first (equal-frequency bins maximize marginal entropy)
const symbols = quantileBins([0.3, 1.7, 0.2, 2.9, 1.1], 2)
```

Streaming, over any pair of live sources:

```ts no-check
import { pairStreams, windowedTransferEntropy } from '@mindpeeker/flow'

const pairs = pairStreams(sourceA, sourceB, { signal }) // lock-step, backpressured
for await (const { index, startSample, te } of windowedTransferEntropy(pairs, {
  windowSize: 512,
  hopSize: 128,
  signal,
})) {
  render(index, startSample, te) // exactly the batch TE of that slice
}
```

## API

### Building blocks (all base-2, plug-in estimates)

| function | returns |
|---|---|
| `shannonEntropy(x, opts?)` | $\hat H(X)$ in bits |
| `jointEntropy([x, y, …], opts?)` | $\hat H(X, Y, \dots)$ |
| `mutualInformation(x, y, opts?)` | $\hat I(X;Y) = \hat H(X) + \hat H(Y) - \hat H(X,Y)$ |
| `conditionalMutualInformation(x, y, z, opts?)` | $\hat I(X;Y \mid Z)$ |

`opts.alphabet` fixes the symbol range (validation + key packing only — the
estimate depends only on counts); `opts.millerMadow` applies the
$\frac{K-1}{2N \ln 2}$ small-sample bias correction per entropy term.

### Transfer entropy

| function | returns |
|---|---|
| `transferEntropy(src, dst, {k, l, lag, alphabet, millerMadow})` | $TE_{X \to Y}$ in bits |
| `localTransferEntropy(src, dst, opts)` | `{values, start, mean, count}` — Lizier pointwise TE, `values[t]` aligned to the predicted sample `dst[t]`, `mean` = plug-in TE |
| `netTransferEntropy(x, y, opts)` | $TE_{X \to Y} - TE_{Y \to X}$ |
| `conditionalTransferEntropy(src, dst, conditions[], {k, l, lag, condK, condLag, alphabet, millerMadow})` | $\hat I(Y_{t+1}; X^{(l)} \mid Y_t^{(k)}, W_1^{(k_c)}, \dots)$ — removes flow explained by observed third streams |
| `collectiveTransferEntropy(sources[], dst, {k, l, lag, alphabet, millerMadow})` | $\hat I(Y_{t+1}; X_1^{(l)}, \dots, X_m^{(l)} \mid Y_t^{(k)})$ — joint transfer incl. synergy |
| `symbolicTransferEntropy(xValues, yValues, {order, delay, k, l, lag})` | Staniek–Lehnertz symbolic TE on ordinal patterns (alphabet $m!$) |

`k` ≥ 1 is the destination history, `l` ≥ 1 the source history, `lag` ≥ 1
the source→destination delay (1 = Schreiber's convention). Conditions use
`condK` symbols ending at $w_{t-u_c+1}$ (`condLag`, default 1 = the source's
time step, PyInform's convention).

### Information storage

| function | returns |
|---|---|
| `activeInformationStorage(x, {k, alphabet, millerMadow})` | $A_X(k) = \hat I(X_t^{(k)}; X_{t+1})$ (Lizier et al. 2012) |
| `localActiveInformationStorage(x, {k})` | `{values, start, mean, count}` — pointwise AIS |
| `entropyRate(x, {k, alphabet, millerMadow})` | $h_\mu(k) = \hat H(X_{t+1} \mid X_t^{(k)})$ |
| `blockEntropy(x, k, opts?)` | $\hat H$ of the $n - k + 1$ overlapping length-$k$ blocks |
| `predictiveInformation(x, {k, kFuture})` | $\hat I(X_t^{(k)}; X_{t+1}^{(k_f)})$ — finite-length excess entropy |

Over the same predicted samples $A_X(k) + h_\mu(k) = \hat H(X_{t+1})$ exactly
(tested), and `predictiveInformation` with `kFuture: 1` is AIS.

### Complexity

| function | returns |
|---|---|
| `permutationEntropy(values, order, {delay, normalize})` | Bandt–Pompe permutation entropy in bits (÷ $\log_2 m!$ with `normalize`) |
| `weightedPermutationEntropy(values, order, {delay, normalize})` | Fadlallah et al. (2013): patterns weighted by window variance |

### Significance

| function | returns |
|---|---|
| `permutationTest(src, dst, {surrogates, surrogate, seed, blockSize, meanBlockSize, markovOrder, …})` | `{te, surrogates, p, mean, sd, z, distinct, surrogate}` |
| `effectiveTransferEntropy(src, dst, {surrogates, seed, …})` | `{te, shuffleMean, ete}` (Marschinski–Kantz, shuffle null) |
| `chiSquareTest(src, dst, {k, l, lag, alphabet, minSamplesPerCell})` | `{te, statistic, df, p, count, cells, occupiedCells, adequate, minSamplesPerCell}` |
| `transferEntropyReport(src, dst, opts)` | `{te, ete, nte, destEntropyRate, z, p, surrogateMean, surrogateSd, distinct, pChiSquare, statistic, df, count, cells, occupiedCells, adequate, embedding, millerMadow, surrogate}` |
| `transferEntropyByLag(src, dst, {minLag, maxLag, alpha, surrogates, …})` | `{lags: [{lag, te, p, significant}], bestLag, te, p, threshold, alpha, maxNull, count, surrogate}` |

`surrogate` selects the null for the source stream (every method is
deterministic for a `seed`, and `surrogate` in the result echoes what ran):

| method | keeps | destroys |
|---|---|---|
| `'shuffle'` (default) | marginal $\hat p(x)$ | all temporal structure (also inside $x^{(l)}$ for $l > 1$) |
| `'circularShift'` | all autocorrelation (up to wraparound) | alignment with the destination; only $n-1$ distinct surrogates — enumerated exactly (`exact: true`) when $n - 1 \le$ `surrogates` |
| `'embeddingShuffle'` | the embedded vectors $x^{(l)}$ (JIDT's convention) | their order across tuples |
| `'blockShuffle'` | multiset + structure inside blocks of `blockSize` (default $\lceil n^{1/3} \rceil$) | structure across block boundaries |
| `'stationaryBootstrap'` | short-range dependence, stationarity (Politis–Romano, mean block `meanBlockSize`) | multiset (resamples with replacement) |
| `'markov'` | order-`markovOrder` transition structure (in distribution) | longer memory and cross-alignment |

`mean`/`sd`/`z` summarize the ensemble (`z` is descriptive — the null is not
normal); `distinct` counts distinct surrogate values, i.e. the actual
resolution of `p`. Method-specific options without the matching `surrogate`
throw `invalid_input`, as does an unknown method; every option is validated
before any estimate runs.

### Surrogates and PRNG

`sourceShuffle(x, rng)`, `circularShift(x, rng)`, `blockShuffle(x, rng,
{blockSize})`, `stationaryBootstrap(x, rng, {meanBlockSize})`,
`markovSurrogate(x, rng, {order})` — every generator copies its input and
takes an explicit generator returning numbers in $[0, 1)$ (anything else
throws). `xoshiro128ss(seed)` is the package's surrogate PRNG (xoshiro128**
seeded through SplitMix64; `seed` any non-negative safe integer);
`xorshift32(seed)` remains for callers pinned to 0.1.0 streams.

### Adapters

- `symbolsFromBytes(bytes, {alphabet: 2 | 256})` — raw byte symbols, or bits
  **MSB-first** (SDK-wide bit order); always a fresh copy, also for `Buffer`
- `quantileBins(values, nBins)` — equal-frequency (rank) binning; ties break
  by original index
- `equalWidthBins(values, nBins)` — equal-width over the observed range
- `ordinalPatterns(values, order, {delay})` — Bandt–Pompe permutation
  symbols in $[0, m!)$ (order ≤ 12)

### Streaming

- `pairStreams(a, b, {signal})` — zips two number/byte streams (or live
  `ByteSource`s) into lock-step pairs with backpressure; ends when either
  side ends and closes both upstream iterators
- `windowedTransferEntropy(pairs, {windowSize, hopSize, k, l, lag, alphabet,
  millerMadow, locals, signal})` — ring-buffered rolling TE whose emissions
  are **exactly** the batch estimator on the corresponding slices; `locals:
  true` adds the window's `localTransferEntropy` result to each point.
  `windowSize` ≤ $2^{28}$; every option is validated before the first pair
  is pulled.

**Abort.** Both generators race every pending upstream pull against the
signal, so an abort rejects promptly with `FlowError('aborted')` — also when
the source stalls, throws its own abort error (`DOMException`,
`EntropyError('aborted')`), or simply ends after the abort. The upstream
error, or `signal.reason`, is the `cause`. Upstream iterators are closed;
after an abort that cleanup waits at most 100 ms.

### Errors

Every failure is a `FlowError` with a stable `code`:

| code | when |
|---|---|
| `invalid_input` | non-integer/negative symbols, misaligned series, bad `k`/`l`/`lag`/`condK`/`condLag`/bins/options, unknown surrogate method, bad seed, rng outside $[0, 1)$, malformed stream items, non-iterable stream inputs |
| `insufficient_data` | fewer samples than the embedding needs |
| `alphabet_overflow` | a symbol or alphabet ≥ $2^{31} - 1$, or ordinal order > 12 |
| `aborted` | the caller's `AbortSignal` fired (cause: upstream error or `signal.reason`) |
| `source_error` | an upstream stream/iterable threw; `cause` is the original error, `source` the provider name (or `'first stream'`/`'second stream'`/`'pair stream'`). A `FlowError` thrown upstream passes through unchanged |

## Theory

Transfer entropy (Schreiber 2000) from $X$ to $Y$ with destination history
$k$, source history $l$, and lag $u$:

$$TE_{X \to Y} = \sum p\!\left(y_{t+1}, y_t^{(k)}, x^{(l)}\right)
  \log_2 \frac{p\!\left(y_{t+1} \mid y_t^{(k)}, x^{(l)}\right)}
              {p\!\left(y_{t+1} \mid y_t^{(k)}\right)}$$

with $y_t^{(k)} = (y_t, \dots, y_{t-k+1})$ and
$x^{(l)} = (x_{t-u+1}, \dots, x_{t-u-l+2})$. It is exactly the conditional
mutual information $I(Y_{t+1}; X^{(l)} \mid Y_t^{(k)})$ — non-negative, zero
iff $X$'s past adds nothing beyond $Y$'s own past, and asymmetric in
$X \leftrightarrow Y$ (unlike mutual information).

The estimator is plug-in: embedded states are counted (exact integer keys
while a state space fits in $2^{53}$, string keys beyond — the switch never
changes results), and each time step contributes a **local** term (Lizier
2008)

$$te(x \to y, t+1) = \log_2 \frac{\hat p(y_{t+1} \mid y_t^{(k)}, x^{(l)})}
  {\hat p(y_{t+1} \mid y_t^{(k)})}$$

whose mean is the TE. Locals can be negative — the source *misinformed*
that prediction — which is what makes them useful as a temporal filter.

**TE is not Massey's directed information.** Directed information
$I(X^n \to Y^n) = \sum_i I(X^i; Y_i \mid Y^{i-1})$ grows its histories and
includes the *instantaneous* term $I(Y_t; X_t \mid \text{pasts})$; transfer
entropy uses fixed finite histories and lags ≥ 1, so zero-lag coupling (a
shared clock, EM pickup within one sample) is invisible to it. This package
does not implement directed information.

**Bias.** The plug-in TE of two finite independent streams is strictly
positive, roughly $\frac{\text{df}}{2N \ln 2}$ bits, where $N$ is the number of
embedded tuples and

$$\text{df} = (A_Y - 1)\, A_Y^{k}\, (A_X^{l} - 1)$$

— with a common alphabet $A$: $(A - 1)A^k(A^l - 1)$ — the number of free
parameters the source adds to the destination's Markov model. The
approximation holds only when $N$ is large against the table; undersampled
tables inflate the bias further.

**Analytic significance (χ²).** Plug-in TE is a log-likelihood ratio
(Barnett & Bossomaier 2012, Phys. Rev. Lett. 109, 138105): under the null of
no transfer, with every cell probability positive,
$G = 2N \ln 2 \cdot TE_{bits} \to \chi^2_{\text{df}}$. `chiSquareTest`
reports $p = Q(\text{df}/2, G/2)$. **Validity rule:** trust it only when
$N \ge 10 \cdot A_Y^{k+1} A_X^l$ (`adequate`; tune with `minSamplesPerCell`).
Measured with this estimator on seeded iid pairs at α = 0.05: binary
$k = l = 1$ rejects 6.3% at $N = 100$ and 5.9% at $N = 500$; alphabet 4 with
$k = 2$ rejects 59% at $N = 500$ (inadequate) and 5.5% at $N = 5000$. The
test also assumes the modelled Markov order and no zero-probability cells —
when in doubt, or when sources are autocorrelated, use surrogates.

**Surrogate significance.**

- permutation test with the add-one empirical p-value
  (Davison & Hinkley 1997; North et al. 2002):
  $$p = \frac{1 + \left|\{\, TE_{\text{surr}} \ge TE_{\text{obs}} \,\}\right|}{1 + n_{\text{surr}}}$$
- effective TE (Marschinski & Kantz 2002):
  $ETE = TE - \langle TE_{X_{\text{shuffled}} \to Y} \rangle$
- normalized TE (Gourévitch & Eggermont 2007):
  $NTE = ETE / \hat H(Y_{t+1} \mid Y_t^{(k)})$
- lag scans (`transferEntropyByLag`) compare every lag with the distribution
  of the per-surrogate **maximum** over lags (IDTxl's max statistic), which
  controls the family-wise error of picking the peak; the true interaction
  delay maximizes TE (Wibral et al. 2013).

**How many surrogates.** The smallest attainable p is $1/(n_{surr} + 1)$, so a
test at level α needs at least $1/α - 1$ surrogates (19 for 0.05, 99 for
0.01) — and then only a surrogate-free ensemble reaches significance. Use
199–999 for a stable p near the threshold (IDTxl defaults to 500), more for
multiplicity-corrected families. Check `distinct`: under `'circularShift'` a
short series has only $n - 1$ distinct surrogates (enumerated exactly), and
coarse tables collapse many surrogates onto equal TE values.

Correctness is pinned in the test suite by closed-form constructions (a
balanced delayed-copy pair whose plug-in TE is exactly 1 bit, a common driver
whose conditional TE is exactly 0, XOR synergy, period-$p$ storage), an
analytically solved coupled binary Markov chain, the χ² closed form for even
df, and checked-in fixtures cross-validated against PyInform (the `inform` C
library) to 1e-12 — including PyInform's documented conditional-TE example
(0.2857142857142857), active information storage and entropy rate.

## Caveats — read before trusting a number

- **TE is not causality.** It measures predictive information transfer under
  the chosen embedding. Unobserved common drivers, wrong `k`/`l`/`lag`, or
  undersampled dynamics all produce spurious flow (and a too-small `k`
  reassigns the destination's own memory to the source). Condition on the
  channels you can observe (`conditionalTransferEntropy`).
- **State-space explosion.** The joint table has $A_Y^{k+1} A_X^{l}$ cells; a
  useful heuristic is $N \gg$ cells. Binary streams with $k = l = 1$ need
  hundreds of samples; alphabet 8 with $k = 2$ already wants tens of
  thousands. `quantileBins` with a *small* `nBins` is usually the right
  trade.
- **Stationarity is assumed.** Counts are pooled over the whole series; if
  the coupling drifts, use `windowedTransferEntropy` (with `locals: true`)
  instead of trusting one global number.
- **Choose the surrogate to match the null you mean.** `shuffle` tests
  "does source *timing* matter at all"; `circularShift`, `blockShuffle`,
  `stationaryBootstrap` and `markov` preserve the source's own dependence and
  are the more honest nulls for autocorrelated sources; `embeddingShuffle`
  keeps the source vectors intact for $l > 1$. Record the returned
  `surrogate` configuration with the result.
- **Scanning lags or embeddings is a multiple comparison.** Use
  `transferEntropyByLag`'s max statistic, or pre-register the lag.
- **Miller–Madow is a mean correction, not magic.** It shifts the estimate
  by a count-based constant; it does not fix undersampled tables and can go
  negative. Surrogates or an adequate χ² test are the trustworthy tools.

## Behaviour changes in 0.2.0

- **Abort** (breaking): an abort while an upstream pull is pending now
  rejects with `FlowError('aborted')` (cause: the upstream error or
  `signal.reason`) instead of leaking the source's `DOMException` /
  `EntropyError`; stalled sources no longer hang `pairStreams` /
  `windowedTransferEntropy`; an upstream that ends after the abort is
  `aborted`, not a normal end; cleanup after abort waits ≤ 100 ms.
- **New error code `source_error`** (breaking): non-abort upstream failures
  are wrapped (`cause`, `source`) instead of propagating raw. `FlowError`
  gained the optional `source` field.
- **Surrogate PRNG** (breaking for recorded ensembles): `permutationTest`
  and `effectiveTransferEntropy` draw from `xoshiro128ss` (SplitMix64-seeded
  xoshiro128**) instead of `xorshift32`, so the same `seed` gives different
  surrogates than 0.1.0; seeds must be non-negative safe integers.
  `xorshift32` now rejects seeds outside $[0, 2^{32} - 1]$ instead of
  silently aliasing them.
- **`permutationTest`** throws `invalid_input` for an unknown `surrogate`
  (it silently used `circularShift`), validates every option before
  computing anything, counts surrogate values within a relative $10^{-12}$ of
  the observed TE as ties (conservative), enumerates all $n - 1$ rotations
  when `surrogate: 'circularShift'` and $n - 1 \le$ `surrogates` (the ensemble
  then has $n - 1$ members), and returns `mean`, `sd`, `z`, `distinct` and
  `surrogate` in addition to `te`/`surrogates`/`p`.
- **`effectiveTransferEntropy`**: `nShuffles` renamed to `surrogates`
  (`nShuffles` still accepted as a deprecated alias; conflicting values
  throw). `shuffleMean` is a running mean (differences in the last ulp).
- **`symbolsFromBytes`** always returns a fresh plain `Uint8Array` (a
  `Buffer` input was aliased) and rejects anything that is not a
  `Uint8Array`/`Buffer`/`Uint8ClampedArray`.
- **Streaming validation**: `windowedTransferEntropy` validates
  `k`/`l`/`lag`/`alphabet`/`windowSize` (now ≤ $2^{28}$) before pulling,
  checks every pair on arrival (`null`, non-symbol values → `invalid_input`
  instead of `TypeError`/late errors); `pairStreams` rejects non-iterable
  inputs and non-symbol numbers.
- **`equalWidthBins`** divides before scaling: overflowing (±1.7e308) and
  subnormal ranges bin correctly; values lying exactly on a bin edge may
  round differently than in 0.1.0.
- **`weightedPermutationEntropy`** rescales magnitudes above $2^{256}$ by a
  power of two instead of returning `NaN`.
- Integer state keys now extend to $2^{53}$ (was $2^{31}$) — faster, same
  results. Transfer-entropy values are bit-identical to 0.1.0.
- New dependency on `@mindpeeker/negentropy` (`./numerics` only).
- `package.json` keyword `directed-information` removed (TE is not Massey's
  directed information — see Theory).

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate fixtures (PyInform reference)
# PyInform ships an x86_64 dylib only; on Apple Silicon:
uv run --python cpython-3.11-macos-x86_64-none scripts/fixtures/generate.py [te|conditional|storage]
```
