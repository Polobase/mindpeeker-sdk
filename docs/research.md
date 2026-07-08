# Randomness, order, and meaning: the research behind the mindpeeker SDK

This document is the research synthesis for the mindpeeker workspace. It explains, package by
package, the science each module implements, the history it inherits, and — where the subject
matter is contested — exactly where the verifiable mathematics ends and the esoteric claim
begins. The stack's design stance throughout: **implement the math exactly, state the
hypothesis honestly, and never let the second borrow credibility from the first.**

---

## 1. Entropy sources and conditioning — `@mindpeeker/entropy`

"Random" hides several distinct physical claims, and the entropy package classifies every
provider by which one it actually makes.

**Quantum sources** (ANU's vacuum-fluctuation QRNG, ID Quantique's photon-detection hardware,
photonic devices from Cisco Outshift, QCi, and the University of Padova) derive
unpredictability from quantum measurement — non-deterministic *in principle*, by the laws of
physics as currently understood. **Classical true RNGs** (atmospheric radio noise at
RANDOM.ORG, ADC thermal noise in microphones and ESP32s, camera sensor noise, CPU timing
jitter) exploit chaotic macroscopic physics: deterministic in principle, unmeasurable in
practice — a weaker but still physical claim. **CSPRNGs** are pure computation: flawless
statistics, zero physical unpredictability, secure only against computationally bounded
adversaries who lack the state. **Beacons** (drand, the NIST Randomness Beacon, blockchain
values) are not private entropy at all — they are *shared, verifiable* randomness, public by
design. The package encodes this taxonomy in every provider's `kind` and `privacy` metadata so
downstream code cannot accidentally treat a public beacon as a secret seed.

The engineering standard for physical sources is NIST SP 800-90B ([NIST,
2018](https://csrc.nist.gov/pubs/sp/800/90/b/final)). Its central quantity is
**min-entropy**, H<sub>min</sub> = −log₂(max<sub>x</sub> P(x)) — the pessimistic measure that
answers "how hard is the *best possible* guesser's job?", always ≤ Shannon entropy. SP 800-90B
prescribes: (1) estimating H<sub>min</sub> from raw samples (the package's quality tooling runs
the most-common-value and Markov estimators, exposed in `@mindpeeker/negentropy` as
`mcvMinEntropy` and `markovMinEntropyPerBit`); (2) **continuous health tests** — the Repetition
Count Test (RCT), which catches a source that gets stuck, and the Adaptive Proportion Test
(APT), which catches large drops in entropy rate (§4.4); and (3) **conditioning** through
vetted functions such as SHA-256, with output entropy credited conservatively rather than
assumed full.

`@mindpeeker/entropy` implements this pipeline for all local physical sources: raw samples →
always-on RCT/APT → SHA-256 extraction against a fixed per-source entropy credit. A failing
source throws a typed `EntropyError('health_test')` — it never silently degrades to
pseudo-randomness. The credits are deliberately paranoid and empirically validated: the camera
source is credited 1 bit/byte against a measured ~7 bits/byte, and CPU jitter is credited 1/16
bit per timing delta against heavily structured raw output (Shannon ≈ 2.2 bits/byte,
gzip-compressible to 10%). A `conditioning: 'raw'` escape hatch exposes health-tested but
unwhitened bits for research workflows that need the physics, not the whitening — with the
attribution renamed (`name(raw)`) so provenance is never ambiguous.

One epistemic point governs everything downstream: **statistical tests can only fail a source,
never certify one.** Any CSPRNG passes every battery in SP 800-22 ([NIST,
2010](https://csrc.nist.gov/pubs/sp/800/22/r1/upd1/final)) by construction. Whitened cloud
output is therefore statistically indistinguishable from local physics; you choose sources by
trust model and physical class, not by test scores.

## 2. Negentropy and order detection — `@mindpeeker/negentropy`

Erwin Schrödinger, in *What is Life?* (1944), described organisms as feeding on "negative
entropy"; Léon Brillouin compressed the phrase to **negentropy** and connected it to
information theory — his "negentropy principle of information" holds that acquiring information
is paid for by an entropy increase elsewhere ([Brillouin, 1953](https://doi.org/10.1063/1.1721463)).
In modern statistics the term names a concrete functional: for a random variable X,

> J(X) = H(Gaussian of equal variance) − H(X) ≥ 0,

zero if and only if X is Gaussian — "how far from maximal disorder, at fixed variance." The
package ships the classical moment approximation (skewness²/12 + excess-kurtosis²/48), the
robust contrast estimators of Hyvärinen (*NIPS 10*, 1998)
(`negentropyLogcosh`, `negentropyExp`) with honestly calibrated null distributions, and the
m-spacings differential-entropy estimator of Vasicek (1976), cross-validated against
`scipy.stats.differential_entropy`. A windowed variant answers "*when* did order appear?" over
a stream.

The second detection vocabulary is borrowed from the Global Consciousness Project's trial
statistics (§4): bits are grouped into **trials** of 200, so each trial is Binomial(200, ½)
under the null — mean 100, variance 50, z = (x − 100)/√50. Over step-aligned trials from N
sources the package computes `netvar` (Σ<sub>t</sub> Z(t)², the squared Stouffer statistic,
χ²(T) under H₀), `devvar` (Σ<sub>t</sub>Σ<sub>i</sub> z<sub>i</sub>(t)², χ²(TN)), pairwise
`interSourceCorrelation`, and the classic cumulative deviation D(t) = Σ(Z² − 1) with its exact
χ²-quantile significance envelope. The experiment layer (`registerExperiment`, `session`,
`analyzeBytes`) freezes hypotheses before data collection and embeds a SHA-256 of the frozen
configuration in every result — pre-registration as an API primitive rather than a policy hope.

**What a deviation implies — and what it does not.** A rejected null says exactly one thing:
these bits are inconsistent with the model "independent fair bits." The explanations, in
descending order of prior probability: hardware bias or drift; environmental coupling (mains
interference, temperature, RF pickup); analysis flexibility (the package's significance
envelope is documented — and demonstrated by simulation in its own test suite — to be
*pointwise*: an H₀ path crosses it somewhere far more often than p suggests); ordinary
sampling fluctuation under multiplicity; and only after all of those, anything exotic.
Conversely, a clean pass implies nothing about physical unpredictability. The package's
contribution is exact null distributions (validated against scipy/mpmath fixtures to 1e-9 or
better) and honest p-values in both directions.

## 3. Directed information flow — `@mindpeeker/flow`

Where negentropy asks whether one stream contains order, **transfer entropy** (TE) asks a
directional question about two. [Schreiber (2000)](https://doi.org/10.1103/PhysRevLett.85.461)
defined TE<sub>X→Y</sub> as the information the past of X provides about the next symbol of Y
beyond what Y's own past already provides — exactly the conditional mutual information
I(Y<sub>t+1</sub>; X<sup>(l)</sup> | Y<sub>t</sub><sup>(k)</sup>). Unlike correlation or mutual
information it is asymmetric under X ↔ Y, which is what makes it a probe of *directed*
coupling. The package implements the discrete plug-in estimator with configurable destination
history k, source history l, and lag, plus the **local** (pointwise) TE of [Lizier et al.
(2008)](https://doi.org/10.1103/PhysRevE.77.026110), whose per-timestep terms can go negative
("the source misinformed that prediction") and act as a temporal filter.

Finite samples make raw TE untrustworthy: the plug-in estimate of two *independent* streams is
strictly positive, roughly df/(2N ln 2). The package therefore refuses to ship analytic tails
(the χ² asymptotics are unreliable at realistic sample counts) and provides two
surrogate-based remedies as first-class API: **effective transfer entropy** ([Marschinski &
Kantz, 2002](https://doi.org/10.1140/epjb/e2002-00379-2)), which subtracts the mean TE of
source-shuffled surrogates, and a **permutation test** with the add-one p-value
p = (1 + #{TE<sub>surr</sub> ≥ TE<sub>obs</sub>})/(1 + n) (Davison & Hinkley 1997; North et
al. 2002). Two surrogate constructions are offered because they encode different nulls:
`sourceShuffle` destroys all temporal structure ("does source timing matter at all?"), while
`circularShift` preserves the source's autocorrelation and destroys only cross-alignment — the
stricter, usually more honest null for autocorrelated data, in the lineage of [Theiler et al.
(1992)](https://doi.org/10.1016/0167-2789(92)90102-S). Ordinal-pattern symbolization
(Bandt & Pompe 2002) enables the symbolic TE of Staniek & Lehnertz (2008) for continuous data.

**Why TE between entropy sources is a meaningful probe.** Independence is the load-bearing
assumption of the whole randomness stack: `xorMix` is only as strong as its strongest
*independent* member, and every GCP-style network statistic assumes inter-source independence
under H₀. Two well-conditioned physical sources should show zero TE at every lag; a
statistically robust nonzero TE — surrogate-tested, in a pre-specified direction and lag —
localizes a shared driver (a common power supply, EM environment, temperature swing, or
processing artifact) without assuming any particular coupling form. That makes TE both a
routine *diagnostic* for entropy engineering and the appropriately conservative instrument for
any "field-like coupling" hypothesis from the MMI literature: such hypotheses imply
inter-source structure that TE would detect. The caveats are stated in the package and bear
repeating: TE is predictive information transfer, **not causality**; unobserved common
drivers, wrong embeddings, or undersampled state spaces (the joint table has up to
A<sup>k+l+1</sup> cells) all produce spurious flow.

## 4. Mind–matter interaction statistics — `@mindpeeker/psi`

The claim under study — that intention or collective attention correlates with the output of
physical random sources — has a half-century experimental literature and remains contested.
The package takes no side; it implements the field's best statistical practices so that anyone
running such experiments does so with pre-registered rigor.

**PEAR.** The Princeton Engineering Anomalies Research laboratory (1979–2007) ran the
best-known program: human operators attempted to shift the mean of random event generator
(REG) output under a **tripolar protocol** — pre-stated high intention, low intention, and
baseline, interleaved so that common-mode device bias or drift cancels in the high-minus-low
difference. Their 12-year review reported per-bit anomalous mean shifts on the order of 10⁻⁴ with a
composite z ≈ 3.8 over some 2.5 million trials
([Jahn et al., 1997](https://noosphere.princeton.edu/ejap/abstracts/Jahn_1997.html)).
The crucial sequel: a three-laboratory consortium replication (Princeton, Giessen, Freiburg)
**did not reproduce the primary effect** ([Jahn et al., 2000](http://icrl.org/wp-content/uploads/2020/02/2000-mmi-consortium-portreg-replication.pdf)).
The package's `runTripolar`/`analyzeTripolar` implement the design faithfully — interleaved
intentions, Δz = (z_H − z_L)/√2 as the primary statistic, per-bit effect sizes ε = z/√N with
confidence intervals — because the design's internal controls are good statistics regardless
of what one believes about the hypothesis.

**GCP.** The Global Consciousness Project ([global-mind.org](https://global-mind.org/science2.html))
has run a network of hardware RNGs since 1998, testing whether pre-specified "global events"
coincide with structure in the network's output. Its formal methodology — 200-bit trials at
1 Hz per node, per-trial Stouffer Z across nodes, **netvar** (ΣZ²) as the standard event
statistic with **devvar** as an alternative, and the cumulative deviation plot Σ(Z² − 1) — is
documented in [Bancel & Nelson (2008)](https://noosphere.princeton.edu/papers/pdf/GCP.Events.Mar08.prepress.pdf),
who reported a cumulative significance above 4.5σ over the first 236 formal events; the
project's running composite over roughly 500 events is reported in excess of 7σ. `analyzeEvent` reproduces these conventions as thin, test-pinned compositions of
negentropy's primitives.

**The replication debate.** The skeptical literature is substantial and specific.
[Bösch, Steinkamp & Boller (2006)](https://pubmed.ncbi.nlm.nih.gov/16822162/) meta-analyzed 380
intention-RNG studies and found a significant but extremely small and extremely heterogeneous
effect whose size–sample-size relation, by their Monte Carlo simulation, is consistent with
publication bias ([Radin et al. replied](https://pubmed.ncbi.nlm.nih.gov/16822164/), disputing
the weighting choices; Wilson & Shadish commented separately). For the GCP specifically, May
and Spottiswoode argued that the formal results are sensitive to analyst selection decisions
and are better explained by **decision augmentation** — experimenters intuitively timing
analyses to catch favorable fluctuations — than by machine influence ([May, Utts &
Spottiswoode, 1995](https://thepsifiles.org/paper/may_1995_decision/); [May & Spottiswoode's
response to Nelson and Bancel](https://www.academia.edu/103257696/The_Global_Consciousness_Project_Identifying_the_Source_of_Psi_A_Response_to_Nelson_and_Bancel)).
Notably, GCP analyst Peter Bancel himself concluded after a 17-year exploration that the
correlations behave more like goal-oriented experimenter effects than a global field
([Bancel, 2017](https://www.sciencedirect.com/science/article/abs/pii/S1550830716302324)).

**Stated plainly:** the MMI hypothesis is contested; the mainstream position is that the
anomalies are best explained by selection effects, publication bias, and analytic flexibility.
These tools enable pre-registered rigor. They do not constitute, and cannot produce, proof by
themselves. What the package adds to the methodological arms race is exactly the machinery the
critiques demand: byte-deterministic JSONL recording and replay (`recordSession`/`readSession`
— the recording *is* the paper trail), time-offset surrogates for family-wise honest p-values
(`timeOffsetSurrogates`/`permutationP`, answering the multiplicity objection directly), and
binomial Bayes factors (`binomialBayesFactor`) that — unlike p-values — can quantify evidence
*for* chance.

## 5. Radionics and Malcolm Rae's base-44 — `@mindpeeker/rate`

Radionics begins with Albert Abrams (1863–1924), whose "Electronic Reactions of Abrams"
claimed disease diagnosis from vibratory rates dialed on proprietary boxes. A joint
Scientific American / AMA investigation (1923–24) concluded the reactions "do not exist …
they are merely products of the Abrams practitioner's mind" — famously, one practitioner
diagnosed malaria, diabetes, cancer, and syphilis in a blood sample from a rooster
([Quackwatch](https://quackwatch.org/ncahf/articles/o-r/radionics/)). The lineage continued
through chiropractor Ruth Drown (prosecuted in the US for her instruments) and, in postwar
Britain, civil engineer [George de la Warr](https://en.wikipedia.org/wiki/George_de_la_Warr),
whose Oxford laboratories built dial instruments and "radionic cameras." Radionics has never
demonstrated diagnostic or therapeutic efficacy under controlled conditions and is outside
established science ([Wikipedia](https://en.wikipedia.org/wiki/Radionics)).

Malcolm Rae (1913–1979) enters as the tradition's most mathematically interesting figure.
Dissatisfied with error-prone base-10 dial setting (the Delawarr and Copen instruments), Rae
asked what minimum number of dial calibrations could express "every concept in the human
entity" without interpolation; his answer was **44**, and he judged the base-44 instrument
superior to any base-10 device ([radionics.co.uk](http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information)).
He then eliminated dials entirely with **Magneto-Geometric cards**: concentric circles, each
carrying a short radial line at a specific angle measured from 12 o'clock at one-degree
resolution — the set of angles *is* the rate. Yvon Combe later transcribed thousands of card
patterns into base-10, base-44, and base-336 numeric rate books
([Wired Alchemy](https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/)).

`@mindpeeker/rate` implements the mathematics and is explicit — in a verified-vs-modeled table
in its README — about which is which. **Verified against sources:** the biography, the choice
of 44, the concentric-circle/partial-radius card structure, the angular convention, and the
1..44 one-based digit labels of real Combe rates. **Modeled here:** the exact digit→angle map
θ_d = 2πd/44 (a clean group homomorphism ℤ₄₄ → S¹ consistent with, but not stated by, the
sources), the one-ring-per-digit assignment, and all stream-modulation protocols. On that
geometry the package builds ordinary, testable mathematics: directional statistics (mean
resultant length, circular mean and variance — Mardia & Jupp, *Directional Statistics*, 2000,
cross-checked against `scipy.stats.circmean`/`circvar`), base conversion with a proven angular
error bound of half a target step, pure card geometry and SVG rendering, and three
deterministic modulation maps (`phaseModulate`, `rateMask`, `xorImprint` — the last provably
entropy-preserving and self-inverse, and explicitly *not* cryptography).

**What remains esoteric claim:** everything radionic — that a card "imprints" a substance,
that a rate acts at a distance, that base-44 has any significance beyond Rae's dowsing answer.
The package asserts none of it. Its contribution is narrower and, for research purposes, more
useful: it makes Rae's encoding *exact and reproducible* — same rate in, same angles, same
card, same modulated stream out — which is the precondition for subjecting any claim about it
to a controlled test at all.

## 6. Archetypal mapping — `@mindpeeker/oracle`

Divination systems, stripped of interpretation, are **fixed finite sample spaces with
canonical probability models**: 64 hexagrams, 78 cards, 24 Elder Futhark runes, 16 geomantic
figures (2¹⁶ shield charts). That makes them unusually good targets for exact implementation —
and exactness is not pedantry, because the two traditional I-Ching procedures genuinely differ.
The three-coin method gives each line the distribution (old yin, young yang, young yin, old
yang) = (1/8, 3/8, 3/8, 1/8); the yarrow-stalk procedure gives (1/16, 5/16, 7/16, 3/16)
([I Ching divination](https://en.wikipedia.org/wiki/I_Ching_divination)). Both yield
P(yang) = ½ exactly — so the primary hexagram is uniform over all 64 either way — but yarrow
moves yang lines three times as often as yin lines, changing the joint distribution of primary
and relating hexagrams. A study that conflates the two methods has the wrong null before it
begins.

`@mindpeeker/oracle` implements each system with exact rational probabilities and three
guarantees: **exactness** (rejection sampling instead of modulo reduction; dyadic weighted
draws via the flat case of the Knuth–Yao generating tree, 1976; Fisher–Yates deals with every
swap index rejection-sampled), **determinism** (same bytes in, same reading out — record the
bytes and any reading is reproducible forever), and **accounting** (every cast reports
`bytesConsumed` and `bitsUsed`). Several correctness properties are verified exhaustively in
the test suite rather than statistically — e.g. all 65,280 two-byte streams produce all six
permutations of a 3-element deal exactly equiprobably, and the geomantic Judge lands on an
even-point figure for all 65,536 charts.

**Why bias-free mapping matters for any serious study of symbolic correlation.** The naive
`value % n` mapping over-represents small residues by up to one part in ⌊256^k/n⌋ — a bias
that is invisible casually but enormous on the scale of any plausible anomaly (PEAR-scale
effects are parts in 10⁴). If the mapping is biased, "significant" symbol preferences are
artifacts of arithmetic, not evidence of anything; if the mapping is exact and the input bytes
are conditioned (§1–2), the null hypothesis for any symbolic-correlation study is exactly
uniform and every deviation is attributable to the *source or the hypothesis*, never the
plumbing. Whether a quantum-sourced reading is more meaningful than a `Math.random()` one is a
question the package deliberately does not answer — it only guarantees that the question is
statistically well-posed.

## 7. Verifiable freshness — `@mindpeeker/vdf`

A **verifiable delay function** takes a prescribed amount of *sequential* time to evaluate —
no amount of parallelism helps — yet verifies in logarithmic time ([Boneh, Bonneau, Bünz &
Fisch, 2018](https://eprint.iacr.org/2018/601)). The package implements [Pietrzak's
construction](https://eprint.iacr.org/2018/627) (ITCS 2019): y = x^(2^T) mod N by T repeated
squarings — the Rivest–Shamir–Wagner time-lock puzzle
([1996](https://people.csail.mit.edu/rivest/pubs/RSW96.pdf)) — made publicly verifiable by a
halving protocol that folds the claim in half ⌈log₂ T⌉ times, with Fiat–Shamir challenges
(SHA-256, domain-separated) replacing interaction. Verification costs 2⌈log₂ T⌉ small
exponentiations regardless of T.

Two assumptions carry the construction. First, **sequentiality**: repeated squaring in a group
of unknown order is conjectured to be inherently sequential — an assumption, not a theorem,
and one whose *wall-clock* meaning depends on the fastest squaring hardware anyone owns
(dedicated ASIC/FPGA efforts are 10–100× faster than CPUs; the package's `calibrate()` exists
because a hardcoded T is always wrong somewhere). Second, the **trust story of the modulus**:
sequentiality collapses if anyone knows φ(N). The default modulus is
[RSA-2048](https://en.wikipedia.org/wiki/RSA_numbers#RSA-2048) from the RSA Factoring
Challenge — published 1991, unfactored to this day, with RSA Laboratories stating the primes
were generated on an air-gapped machine and destroyed. That is a *trust statement, not a
proof*: there was no public ceremony, so the package makes the modulus pluggable
(`{ n: bigint }`) for deployments that require a multi-party generation ceremony instead.
Soundness details follow the literature: hashing into the group squares into QR_N to avoid
low-order-element attacks, challenges are 128-bit and bound to the full transcript, and the
security argument lives in the random-oracle model ([Boneh, Bünz & Fisch,
2018](https://eprint.iacr.org/2018/712)).

**Why freshness matters for pre-registration integrity.** A pre-registered experiment is only
as honest as its timeline, and a timeline needs two one-way bounds. Including a public beacon
pulse (drand, NIST — §1) inside a registration document proves the document was created *no
earlier* than the pulse. A VDF seal supplies the opposite bound: `sealBeacon(pulse, T)`
guarantees that *nobody* — regardless of parallel resources or foreknowledge — could know the
sealed output until ≈ T sequential squarings after the pulse bytes were fixed, which blocks
front-running of beacon-derived values (e.g. randomized condition assignment) and
retroactive fitting of "predictions" to already-visible randomness. Together with negentropy's
SHA-256 registration digests (§2), beacon inclusion and VDF sealing bracket an experiment in
time with verifiable, third-party-checkable evidence. The seal does not make a bad beacon
good — if the pulse was predictable, the VDF only delays its consumption — but it makes the
*schedule* of knowledge provable.

## 8. The bridge: how the stack composes, and what would count as evidence

**Composition.** The packages form a pipeline with an integrity spine:

- **Source:** `@mindpeeker/entropy` produces health-tested bytes with honest provenance
  (quantum / classical / algorithmic / public), streamed as `AsyncIterable<Uint8Array>`.
- **Detection:** `@mindpeeker/negentropy` measures order in a stream (and extracts uniform
  bits from imperfect ones); `@mindpeeker/flow` measures directed coupling *between* streams;
  `@mindpeeker/psi` wraps both in the field's canonical experiment protocols with recording,
  replay, surrogates, and Bayes factors.
- **Symbolic layer:** `@mindpeeker/oracle` spends conditioned bits into exactly-distributed
  archetypal readings; `@mindpeeker/rate` renders radionic encodings exact and reproducible.
  Both are mappings with guarantees, not claims with mechanisms.
- **Observation:** `@mindpeeker/visualizer` renders live noise, statistic series with
  significance envelopes, matrices, and rate cards — explicitly a monitoring surface, with the
  pointwise-envelope caveat carried into the UI docs, because *watching* many windows is not
  *claiming* any of them.
- **Integrity:** `@mindpeeker/vdf` plus public beacons time-bracket registrations and seal
  assignments against front-running.

Every seam is structural (a shared stream shape, MSB-first bits, deterministic replay), so the
honest-separation property survives composition: at no point does a statistical result acquire
a metaphysical interpretation by passing through another package.

**Epistemics: what would constitute evidence.** For the contested hypotheses this stack can be
pointed at, a persuasive result would need, at minimum:

1. **Pre-registration with cryptographic teeth** — hypothesis, statistic, window, and
   correction frozen before data collection (`registerExperiment`), time-bracketed by beacon
   inclusion and VDF sealing (§7), with the registration digest published in advance.
2. **Adequate power for honest effect sizes.** PEAR-scale effects are ε ≈ 10⁻⁴ per bit. Since
   z ≈ ε√N, a 5σ detection requires N ≈ (5/10⁻⁴)² = 2.5 × 10⁹ bits — about 145 days of one
   GCP-convention node at 200 bits/s. Underpowered "null results" and lucky small samples are
   both uninformative; the package-level effect-size and CI reporting exists to keep this
   arithmetic in view.
3. **Physical controls.** Matched CSPRNG control runs (an "effect" that persists on
   deterministic bits indicts the analysis, not physics), source swaps, shielding variations,
   and TE-based independence checks between hardware channels (§3).
4. **Family-wise honesty.** Surrogate ensembles (`timeOffsetSurrogates`, `permutationTest`)
   for every claim extracted from a monitored stream; pointwise envelopes never presented as
   path-wise.
5. **Evidence-symmetric statistics.** Bayes factors reported alongside p-values, so chance can
   win on the record.
6. **Independent replication from raw data** — byte-exact JSONL recordings published, so
   critics rerun the exact pipeline; replication by adversarial collaborators weighted above
   replication by proponents (the lesson of the PEAR consortium and the Bösch meta-analysis).

Nothing in this workspace settles the underlying questions, and no single session on your own
hardware will either. What the stack guarantees is narrower and worth having: exact
mathematics, honest nulls, reproducible pipelines, and a paper trail that makes both positive
and negative results *mean something*.

---

## References

**Standards and randomness engineering**

- NIST SP 800-90B, *Recommendation for the Entropy Sources Used for Random Bit Generation*
  (2018). https://csrc.nist.gov/pubs/sp/800/90/b/final
- NIST SP 800-22 Rev. 1a, *A Statistical Test Suite for Random and Pseudorandom Number
  Generators for Cryptographic Applications* (2010).
  https://csrc.nist.gov/pubs/sp/800/22/r1/upd1/final
- NIST Interoperable Randomness Beacons project.
  https://csrc.nist.gov/projects/interoperable-randomness-beacons
- drand / League of Entropy. https://drand.love/

**Negentropy and estimation**

- Schrödinger, E. *What is Life?* Cambridge University Press (1944).
- Brillouin, L. "The Negentropy Principle of Information." *Journal of Applied Physics* 24,
  1152–1163 (1953). https://doi.org/10.1063/1.1721463
- Hyvärinen, A. "New Approximations of Differential Entropy for Independent Component Analysis
  and Projection Pursuit." *Advances in Neural Information Processing Systems 10* (1998).
- Vasicek, O. "A Test for Normality Based on Sample Entropy." *Journal of the Royal
  Statistical Society B* 38(1), 54–59 (1976).

**Information flow**

- Schreiber, T. "Measuring Information Transfer." *Physical Review Letters* 85, 461–464
  (2000). https://doi.org/10.1103/PhysRevLett.85.461
- Lizier, J., Prokopenko, M. & Zomaya, A. "Local information transfer as a spatiotemporal
  filter for complex systems." *Physical Review E* 77, 026110 (2008).
  https://doi.org/10.1103/PhysRevE.77.026110
- Marschinski, R. & Kantz, H. "Analysing the information flow between financial time series."
  *European Physical Journal B* 30, 275–281 (2002). https://doi.org/10.1140/epjb/e2002-00379-2
- Theiler, J. et al. "Testing for nonlinearity in time series: the method of surrogate data."
  *Physica D* 58, 77–94 (1992). https://doi.org/10.1016/0167-2789(92)90102-S
- Bandt, C. & Pompe, B. "Permutation Entropy: A Natural Complexity Measure for Time Series."
  *Physical Review Letters* 88, 174102 (2002). https://doi.org/10.1103/PhysRevLett.88.174102
- Staniek, M. & Lehnertz, K. "Symbolic Transfer Entropy." *Physical Review Letters* 100,
  158101 (2008). https://doi.org/10.1103/PhysRevLett.100.158101

**Mind–matter interaction and its critics**

- Jahn, R., Dunne, B., Nelson, R., Dobyns, Y. & Bradish, G. "Correlations of Random Binary
  Sequences with Pre-Stated Operator Intention: A Review of a 12-Year Program." *Journal of
  Scientific Exploration* 11(3), 345–367 (1997).
  https://noosphere.princeton.edu/ejap/abstracts/Jahn_1997.html
- Jahn, R. et al. "Mind/Machine Interaction Consortium: PortREG Replication Experiments."
  *Journal of Scientific Exploration* 14(4), 499–555 (2000).
  http://icrl.org/wp-content/uploads/2020/02/2000-mmi-consortium-portreg-replication.pdf
- Nelson, R. et al. — Global Consciousness Project methodology. https://global-mind.org/science2.html
- Bancel, P. & Nelson, R. "The GCP Event Experiment: Design, Analytical Methods, Results."
  *Journal of Scientific Exploration* 22(3) (2008).
  https://noosphere.princeton.edu/papers/pdf/GCP.Events.Mar08.prepress.pdf
- Bösch, H., Steinkamp, F. & Boller, E. "Examining Psychokinesis: The Interaction of Human
  Intention With Random Number Generators — A Meta-Analysis." *Psychological Bulletin* 132(4),
  497–523 (2006). https://pubmed.ncbi.nlm.nih.gov/16822162/
- Radin, D., Nelson, R., Dobyns, Y. & Houtkooper, J. "Reexamining Psychokinesis: Comment on
  Bösch, Steinkamp, and Boller (2006)." *Psychological Bulletin* 132(4), 529–532 (2006).
  https://pubmed.ncbi.nlm.nih.gov/16822164/
- May, E., Utts, J. & Spottiswoode, S.J. "Decision Augmentation Theory: Toward a Model of
  Anomalous Mental Phenomena." *Journal of Parapsychology* 59, 195–220 (1995).
  https://thepsifiles.org/paper/may_1995_decision/
- May, E. & Spottiswoode, S.J. "The Global Consciousness Project, Identifying the Source of
  Psi: A Response to Nelson and Bancel." *Journal of Scientific Exploration* 25(4) (2011).
  https://www.academia.edu/103257696/The_Global_Consciousness_Project_Identifying_the_Source_of_Psi_A_Response_to_Nelson_and_Bancel
- Bancel, P. "Searching for Global Consciousness: A 17-Year Exploration." *Explore* 13(2),
  94–101 (2017). https://www.sciencedirect.com/science/article/abs/pii/S1550830716302324

**Radionics and Malcolm Rae**

- Barrett, S. "Radionics and Albert Abrams, M.D." Quackwatch.
  https://quackwatch.org/ncahf/articles/o-r/radionics/
- Wikipedia: Radionics. https://en.wikipedia.org/wiki/Radionics
- Wikipedia: George de la Warr. https://en.wikipedia.org/wiki/George_de_la_Warr
- radionics.co.uk — MGA-Rae information.
  http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information
- Wired Alchemy — "The 10, the 44, and the 336."
  https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/
- Wired Alchemy — Malcolm Rae MGA cards.
  https://wiredalchemy.com/radionic-rates-dials/malcolm-rae-cards/
- Mardia, K.V. & Jupp, P.E. *Directional Statistics.* Wiley (2000).

**Archetypal systems**

- Wikipedia: I Ching divination (yarrow vs coin probabilities).
  https://en.wikipedia.org/wiki/I_Ching_divination
- Knuth, D. & Yao, A. "The Complexity of Nonuniform Random Number Generation." In *Algorithms
  and Complexity: New Directions and Recent Results* (1976).
- Knuth, D. *The Art of Computer Programming*, Vol. 2, Algorithm 3.4.2P (Fisher–Yates).

**Verifiable delay functions**

- Pietrzak, K. "Simple Verifiable Delay Functions." *ITCS 2019*.
  https://eprint.iacr.org/2018/627
- Boneh, D., Bonneau, J., Bünz, B. & Fisch, B. "Verifiable Delay Functions." *CRYPTO 2018*.
  https://eprint.iacr.org/2018/601
- Boneh, D., Bünz, B. & Fisch, B. "A Survey of Two Verifiable Delay Functions." (2018).
  https://eprint.iacr.org/2018/712
- Rivest, R., Shamir, A. & Wagner, D. "Time-lock puzzles and timed-release Crypto." MIT/LCS
  (1996). https://people.csail.mit.edu/rivest/pubs/RSW96.pdf
- Wikipedia: RSA numbers — RSA-2048. https://en.wikipedia.org/wiki/RSA_numbers#RSA-2048
