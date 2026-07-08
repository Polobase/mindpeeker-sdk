# @mindpeeker/flow

Transfer entropy and directed information flow for discrete symbol streams.

Where [`@mindpeeker/entropy`](../entropy) sources randomness and
[`@mindpeeker/negentropy`](../negentropy) asks whether one stream contains
order, flow asks a directional question about **two** streams:

> How many bits does the past of $X$ tell me about the next symbol of $Y$,
> beyond what $Y$'s own past already tells me?

Zero dependencies, browser-safe (only `Math` and typed arrays), ESM.
Everything operates on integer symbol arrays (`Uint8Array`,
`ArrayLike<number>`); adapters turn bytes and continuous measurements into
symbols. Every `@mindpeeker/entropy` provider works as a live input
*structurally* — the packages share a shape, not code:

```ts
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

## Quick start

```ts
import {
  transferEntropy, netTransferEntropy, effectiveTransferEntropy,
  permutationTest, quantileBins,
} from '@mindpeeker/flow'

// two aligned integer symbol series (any non-negative alphabet)
const te = transferEntropy(x, y, { k: 1, l: 1 })      // TE X→Y in bits
const net = netTransferEntropy(x, y)                  // TE X→Y − TE Y→X

// finite samples ALWAYS give positive TE — never read a raw value without a null:
const { te: obs, p } = permutationTest(x, y, { surrogates: 199, seed: 42 })
const { ete } = effectiveTransferEntropy(x, y, { nShuffles: 20, seed: 42 })

// continuous data? bin it first (equal-frequency bins maximize marginal entropy)
const sym = quantileBins(measurements, 4)
```

Streaming, over any pair of live sources:

```ts
import { pairStreams, windowedTransferEntropy } from '@mindpeeker/flow'

const pairs = pairStreams(sourceA, sourceB, { signal })  // lock-step, backpressured
for await (const { index, startSample, te } of windowedTransferEntropy(pairs, {
  windowSize: 512,
  hopSize: 128,
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
| `effectiveTransferEntropy(src, dst, {nShuffles, seed, …})` | `{te, shuffleMean, ete}` (Marschinski–Kantz) |
| `permutationTest(src, dst, {surrogates, surrogate, seed, …})` | `{te, surrogates, p}` |

`k` ≥ 1 is the destination history, `l` ≥ 1 the source history, `lag` ≥ 1
the source→destination delay (1 = Schreiber's convention).

### Surrogates

`sourceShuffle(x, rng)` (Fisher–Yates — destroys all temporal structure,
keeps the marginal) and `circularShift(x, rng)` (random rotation — keeps
autocorrelation, destroys cross-alignment). Both take an explicit generator;
`xorshift32(seed)` is exported so surrogate ensembles are reproducible.

### Adapters

- `symbolsFromBytes(bytes, {alphabet: 2 | 256})` — raw byte symbols, or bits
  **MSB-first** (SDK-wide bit order)
- `quantileBins(values, nBins)` — equal-frequency (rank) binning; ties break
  by original index
- `equalWidthBins(values, nBins)` — equal-width over the observed range
- `ordinalPatterns(values, order, {delay})` — Bandt–Pompe permutation
  symbols in $[0, m!)$; feed both streams through it for the symbolic TE of
  Staniek–Lehnertz

### Streaming

- `pairStreams(a, b, {signal})` — zips two number/byte streams (or live
  `ByteSource`s) into lock-step pairs with backpressure; ends when either
  side ends
- `windowedTransferEntropy(pairs, {windowSize, hopSize, k, l, lag, signal})`
  — ring-buffered rolling TE whose emissions are **exactly** the batch
  estimator on the corresponding slices

All async generators honor `AbortSignal` and throw a `FlowError` with code
`'aborted'`. Error codes: `'invalid_input' | 'insufficient_data' |
'alphabet_overflow' | 'aborted'`.

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

The estimator is plug-in: embedded states are counted (packed integer keys
while $A^{k+l+1} < 2^{31}$, string keys beyond — the switch never changes
results), and each time step contributes a **local** term (Lizier 2008)

$$te(x \to y, t+1) = \log_2 \frac{\hat p(y_{t+1} \mid y_t^{(k)}, x^{(l)})}
  {\hat p(y_{t+1} \mid y_t^{(k)})}$$

whose mean is the TE. Locals can be negative — the source *misinformed*
that prediction — which is what makes them useful as a temporal filter.

**Bias and significance.** The plug-in TE of two finite independent streams
is strictly positive, roughly $\frac{\text{df}}{2N \ln 2}$. Two remedies are
provided, both surrogate-based (this package deliberately has no analytic
tails — the χ² asymptotics are unreliable at realistic sample counts):

- effective TE (Marschinski & Kantz 2002):
  $ETE = TE - \langle TE_{X_{\text{shuffled}} \to Y} \rangle$
- permutation test with the add-one empirical p-value
  (Davison & Hinkley 1997; North et al. 2002):
  $$p = \frac{1 + \left|\{\, TE_{\text{surr}} \ge TE_{\text{obs}} \,\}\right|}{1 + n_{\text{surr}}}$$

Correctness is pinned three ways in the test suite: closed-form
constructions (a balanced delayed-copy pair whose plug-in TE is exactly
1 bit), an analytically solved coupled binary Markov chain (estimator vs the
exact stationary-distribution TE), and checked-in fixtures cross-validated
against PyInform (the `inform` C library) to 1e-9.

## Caveats — read before trusting a number

- **TE is not causality.** It measures predictive information transfer under
  the chosen embedding. Unobserved common drivers, wrong `k`/`l`/`lag`, or
  undersampled dynamics all produce spurious flow (and a too-small `k`
  reassigns the destination's own memory to the source).
- **State-space explosion.** The joint table has up to $A^{k+l+1}$ cells; a
  useful heuristic is $N \gg A^{k+l+1}$. Binary streams with $k = l = 1$ need
  hundreds of samples; alphabet 8 with $k = 2$ already wants tens of
  thousands. `quantileBins` with a *small* `nBins` is usually the right
  trade.
- **Stationarity is assumed.** Counts are pooled over the whole series; if
  the coupling drifts, use `windowedTransferEntropy` and watch the locals
  instead of trusting one global number.
- **Choose the surrogate to match the null you mean.** `shuffle` tests
  "does source *timing* matter at all"; `circularShift` preserves the
  source's autocorrelation and is the stricter (usually more honest) null
  for autocorrelated sources.
- **Miller–Madow is a mean correction, not magic.** It shifts the estimate
  by a count-based constant; it does not fix undersampled tables and can go
  negative. Effective TE or the permutation test are the trustworthy tools.

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate fixtures (PyInform reference)
# PyInform ships an x86_64 dylib only; on Apple Silicon:
uv run --python cpython-3.11-macos-x86_64-none scripts/fixtures/generate.py
```
