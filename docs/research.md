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

**Quantum sources** (ANU's vacuum-fluctuation QRNG, ID Quantique, Cisco Outshift, QCi, and the
University of Padova) derive unpredictability from quantum measurement — non-deterministic *in
principle*, by the laws of physics as currently understood. **Classical true RNGs** (atmospheric
radio noise at RANDOM.ORG, ADC thermal noise in microphones and ESP32s, camera sensor noise, CPU
timing jitter) exploit chaotic macroscopic physics: deterministic in principle, unmeasurable in
practice — a weaker but still physical claim. **CSPRNGs** are pure computation: flawless
statistics, zero physical unpredictability, secure only against computationally bounded
adversaries who lack the state. **Beacons** (drand, the NIST Randomness Beacon, blockchain values)
are not private entropy at all — they are *shared, verifiable* randomness, public by design. Every
provider's `kind` and `privacy` metadata encodes this taxonomy, so downstream code cannot mistake
a public beacon for a secret seed.

The engineering standard for physical sources is NIST SP 800-90B ([NIST,
2018](https://csrc.nist.gov/pubs/sp/800/90/b/final); errata are listed for a future revision, but
no revision draft exists). Its central quantity is **min-entropy**,
$H_{\min} = -\log_2 \max_x P(x)$ — set by the *best possible* guess, always ≤ Shannon entropy.
It prescribes estimating $H_{\min}$ from raw samples; **health tests** — a start-up test, then the
Repetition Count Test (RCT) for a stuck source and the Adaptive Proportion Test (APT) for lost
entropy; and **conditioning** through vetted functions such as SHA-256. The companion SP 800-90C
is final since 2025-09-25 ([NIST, 2025](https://csrc.nist.gov/pubs/sp/800/90/c/final)): a vetted
conditioning function's output counts as **full entropy** when its input carries at least the
output length plus 64 bits of entropy from validated sources (§3.2.2.2). The claim is only as good
as the credit fed in, and the SDK's sources carry no NIST validation, so the package makes no
formal full-entropy claim. It pools `safetyFactor × 256` credited bits per 32-byte block (1.25
would meet the SP 800-90C margin; the provider defaults are 2 to 8), with credits set far below
measured values: the camera is credited 1 bit/byte against a measured ~7, CPU jitter 1/16 bit per
timing delta.

`@mindpeeker/entropy` runs this pipeline for every local physical source. No sample of a
session is released before 1024 raw samples pass the tests. The tests false-alarm by design at
α = 2⁻²⁰ per sample, so an alarm now triggers a restart (`onHealthFailure: 'retest'`), and only
the third alarm in a session throws `EntropyError('health_test')`; in 0.1 the first alarm was
fatal and 6 % of healthy 1 MiB reads failed. The APT cutoff is now the exact binomial critical
value, computed in log space. **In 0.1 that computation underflowed and silently disabled the
APT for the jitter and sensor providers** — the lowest-credit sources. For bits that are *meant*
to be reproducible, `drbgProvider` (SP 800-90A HMAC_DRBG over a recorded seed) replays
byte-exactly — the pseudo-random control arm of §14, never a secret.

NIST IR 8213, the Randomness Beacon 2.0 format, is still an [initial public
draft](https://csrc.nist.gov/pubs/ir/8213/ipd), and NIST calls the service a beta. Chain 2 began
on 2022-09-21, and nothing was published between 2025-10-01 and 2025-11-13. Since 2026-09-03,
NIST pulses carry 512-byte signatures while naming a 2048-bit certificate, so they cannot be
signature-verified: `nistBeacon({ verify: true })` fails on them, as it should (a checked-in pulse
pins this), while `verify: 'hash'` passes.

One epistemic point governs everything downstream: **statistical tests can only fail a source,
never certify one.** Any CSPRNG passes every battery in SP 800-22 ([NIST,
2010](https://csrc.nist.gov/pubs/sp/800/22/r1/upd1/final)) by construction, so sources are
chosen by trust model and physical class, not by test scores. The batteries need scrutiny too:
the printed examples of SP 800-22's Fourier test (§2.6) contradict its own formula, so
negentropy's `spectralTest` is checked against an independent DFT, and the spec's variance
divisor of 4 should be 3.8 ([Kim, Umeno & Hasegawa, 2004](https://eprint.iacr.org/2004/018)),
making NIST's p-values anti-conservative (`variance: 'kim2004'` corrects it).

## 2. Negentropy and order detection — `@mindpeeker/negentropy`

Erwin Schrödinger (*What is Life?*, 1944) wrote that "what an organism feeds upon is negative
entropy". The contracted **negentropy** titles Léon Brillouin's paper tying the idea to
information theory: acquiring information is paid for by an entropy increase elsewhere
([Brillouin, 1953](https://doi.org/10.1063/1.1721463)).[^negentropy] In statistics the term
names a functional, $J(X) = H(X_{\text{Gauss}}) - H(X) \ge 0$ against the Gaussian of equal
variance, zero if and only if X is Gaussian. The package ships moment, Hyvärinen (1998) and
Vasicek (1976) estimators with calibrated nulls, and a windowed variant for "*when* did order
appear?"

The second vocabulary is the Global Consciousness Project's (§4): bits are grouped into
**trials** of 200, Binomial(200, ½) under the null. Over step-aligned trials from N sources the
package computes `netvar` ($\sum_t Z(t)^2$ for the per-step Stouffer Z, $\chi^2(T)$ under H₀),
`devvar` ($\sum_t \sum_i z_i(t)^2$, $\chi^2(TN)$), `covar`, pairwise statistics, and the
cumulative deviation $D(t) = \sum (Z^2 - 1)$ with a χ²-quantile envelope. GCP 2.0 ([Plonka et
al., 2026](https://doi.org/10.1016/j.explore.2025.103312)) calls netvar "Network Coherence
(Phase)" and a standardized device variance "Network Coherence (Amplitude)"; the package's
`networkCoherence` is neither but the mean pairwise product, an uncentered co-moment in which a
common mean shift μ reads as ≈ μ² (the correlation is `pearson`). χ² p-values are exact at any
df: in 0.1 `chi2Sf` threw from df ≈ 3.7·10⁶ at or below the mean, so a one-day devvar over 60
sources at 1 Hz crashed on about half of all healthy runs; Temme's expansion now agrees with
40-digit mpmath to ≤ 2·10⁻¹³ up to a = 5·10⁸.

**Optional stopping.** A pointwise envelope answers a fixed-time question. Watching the curve
and stopping when it looks significant asks a different one: in seeded simulations, 46 % of
3000-step H₀ paths cross the pointwise χ² envelope somewhere. By the law of the iterated
logarithm, a fixed-n test repeated at every n eventually rejects with probability one (ark-db
library, *The Theory of Gambling and Statistical Logic* (Epstein), p. 423); checking a fixed-n
p-value after every flip from 10 to 2000 rejects a fair coin with probability 0.511.

The remedy is a **test martingale**: $M_0 = 1$, $M_t \ge 0$, and
$E[M_t \mid \text{past}] \le M_{t-1}$ under H₀. By Ville's inequality,
$P_{H_0}(\exists t: M_t \ge 1/\alpha) \le \alpha$ uniformly in time, so one may look after every
step and stop at will ([Shafer et al., 2011](https://doi.org/10.1214/10-STS347); [Howard et al.,
2021](https://doi.org/10.1214/20-AOS1991)). `netvarMartingale` mixes over the precision of Z with
a Gamma(a, b) prior; with $V_t = \sum Z^2 = t + D_t$,

$$\ln M_t = \frac{V_t}{2} + a \ln b - \ln\Gamma(a) + \ln\Gamma\!\left(a + \frac t2\right) - \left(a + \frac t2\right)\ln\!\left(b + \frac{V_t}{2}\right).$$

`driftMartingale` mixes over the mean with an N(0, 1/λ) prior,
$M_t = \sqrt{\lambda/(t+\lambda)}\,\exp\big(S_t^2/(2(t+\lambda))\big)$ for $S_t = \sum z$, and
crosses $1/\alpha$ exactly when
$|S_t| \ge \sqrt{(t+\lambda)\ln\big((t+\lambda)/(\lambda\alpha^2)\big)}$ ([Robbins,
1970](https://doi.org/10.1214/aoms/1177696786)). Each time-uniform boundary is crossed by only
0.9–3.2 % of the simulated H₀ paths, and psi's `CoinEProcess` rejects the coin above with
probability 0.037 at 1/α = 20. The price is power at a fixed horizon (about 2.2× the pointwise
envelope at t = 1000). The guarantee is exact for Gaussian z and holds as a supermartingale for
fair-bit trials in the variance-excess and drift forms; empirical calibration or drifting hardware
break the H₀ model itself. The prior, side and α belong in the registration.

**What a deviation implies.** A rejected null says only that these bits are inconsistent with
"independent fair bits." In descending order of prior probability: hardware bias or drift,
environmental coupling, analysis flexibility, sampling fluctuation under multiplicity — and only
then anything exotic. A clean pass, conversely, implies nothing about physical unpredictability.

[^negentropy]: Schrödinger wrote "negative entropy" and noted he perhaps should have said "free
    energy" (ark-db library, *The Rainbow and the Worm* (Mae-Wan Ho), p. 84); some secondary
    sources credit him with "negentropy" itself (ark-db library, *The Posthuman Condition*
    (Pepperell), p. 67). Who coined the word is left open here.

## 3. Directed information flow — `@mindpeeker/flow`

Where negentropy asks whether one stream contains order, **transfer entropy** (TE) asks a
directional question about two. [Schreiber (2000)](https://doi.org/10.1103/PhysRevLett.85.461)
defined $TE_{X \to Y}$ as the information the past of X provides about the next symbol of Y
beyond what Y's own past already provides — the conditional mutual information
$I(Y_{t+1}; X^{(l)} \mid Y_t^{(k)})$. Unlike correlation or mutual information it is asymmetric
under X ↔ Y. It is not Massey's (1990) directed information, which grows its histories and
includes the instantaneous term; TE uses fixed finite histories and lags ≥ 1, so zero-lag
coupling (a shared clock, EM pickup within one sample) is invisible to it. The package
implements the discrete plug-in estimator with destination history k, source history l, and lag;
the **local** TE of [Lizier et al. (2008)](https://doi.org/10.1103/PhysRevE.77.026110), whose
per-timestep terms can go negative and act as a temporal filter; conditional TE, which removes
flow explained by observed third streams; and active information storage ([Lizier, Prokopenko &
Zomaya, 2012](https://doi.org/10.1016/j.ins.2012.04.016)) — all cross-checked against PyInform.

Finite samples bias plug-in TE upward: for independent streams it is roughly
$\mathrm{df}/(2N \ln 2)$ bits over N embedded tuples, with
$\mathrm{df} = (A_Y - 1)\,A_Y^{k}\,(A_X^{l} - 1)$ for alphabet sizes $A_X$, $A_Y$. The same df
gives an analytic test: plug-in TE is a log-likelihood ratio, so under no transfer
$G = 2N \ln 2 \cdot TE \to \chi^2(\mathrm{df})$ ([Barnett & Bossomaier,
2012](https://doi.org/10.1103/PhysRevLett.109.138105)). `chiSquareTest` flags the result
`adequate` only when $N \ge 10\,A_Y^{k+1} A_X^{l}$, and measured false-positive rates at α = 0.05
show why: binary k = l = 1 rejects 6.3 % at N = 100 and 5.9 % at N = 500, but alphabet 4 with k =
2 rejects 59 % at N = 500 and 5.5 % at N = 5000. The test also assumes the modelled Markov order
and no zero-probability cells, so surrogates remain the default remedy: **effective transfer
entropy** ([Marschinski & Kantz, 2002](https://doi.org/10.1140/epjb/e2002-00379-2)) subtracts the
mean TE of shuffled surrogates, and a **permutation test** reports
$p = (1 + \text{count}(TE_{\text{surr}} \ge TE_{\text{obs}}))/(1 + n)$ (Davison & Hinkley 1997;
North et al. 2002). The surrogate encodes the null: `shuffle` destroys all temporal structure,
while `circularShift` preserves the source's autocorrelation and destroys only cross-alignment —
usually the more honest null for autocorrelated data, in the lineage of [Theiler et al.
(1992)](https://doi.org/10.1016/0167-2789(92)90102-S). Ordinal patterns (Bandt & Pompe 2002) give
the symbolic TE of Staniek & Lehnertz (2008) for continuous data.

**Why TE between entropy sources is a meaningful probe.** Independence is the load-bearing
assumption of the randomness stack: `xorMix` is only as strong as its strongest *independent*
member, and every GCP-style network statistic assumes independent sources under H₀. Two
well-conditioned sources should show zero TE at every lag; a robust nonzero TE — surrogate-tested,
in a pre-specified direction and lag — localizes a shared driver (power supply, EM environment,
temperature, processing artifact) without assuming a coupling form. That makes TE a routine
*diagnostic* and a conservative instrument for any "field-like coupling" hypothesis, which
implies inter-source structure TE would detect at lags ≥ 1. TE is predictive information
transfer, **not causality**: unobserved common drivers, wrong embeddings, or undersampled state
spaces (the joint table has $A_Y^{k+1} A_X^{l}$ cells) all produce spurious flow.

## 4. Mind–matter interaction statistics — `@mindpeeker/psi`

The claim under study — that intention or collective attention correlates with the output of
physical random sources — has a half-century experimental literature and remains contested.
The package takes no side; it implements the field's best statistical practices.

**PEAR.** The Princeton Engineering Anomalies Research lab (1979–2007) ran the best-known program:
operators tried to shift the mean of random event generator (REG) output under a **tripolar
protocol** — high, low and baseline intentions, their order chosen by the operator (volitional) or
randomly assigned (instructed) and recorded before the REG started, so common-mode bias or drift
cancels in the high-minus-low difference. Benchmark trials were 200 bits counted at 1000 bits/s,
in runs of 50, 100 or 1000 trials. For the benchmark REG alone the 12-year review reports
2,497,200 trials in 522 series with a HI−LO separation of z = 3.81 (p = 7 × 10⁻⁵); the composite
over all its experiments exceeds 7σ, at effect sizes of order 10⁻⁴ per bit ([Jahn et al.,
1997](https://www.pear-lab.com/pdfs/1997-correlations-random-binary-sequences-12-year-review.pdf)).
A three-laboratory consortium replication **did not reproduce the primary effect** ([Jahn et al.,
2000](http://icrl.org/wp-content/uploads/2020/02/2000-mmi-consortium-portreg-replication.pdf)).
PEAR's reports on deterministic sources differ: the 1997 review finds no correlation with strictly
deterministic pseudo-random sources, while an earlier account reports comparable results on
pseudo-random and prerecorded sources (ark-db library, *The Roots of Consciousness* (Mishlove), p.
312). PEAR read both as facts about the phenomenon; the rule used here — an effect that persists
on deterministic bits indicts the analysis — is this workspace's methodological stance.
`analyzeTripolar`'s primary statistic is
$\Delta z = (\varepsilon_H - \varepsilon_L)/\sqrt{1/N_H + 1/N_L}$, which reduces to
$(z_H - z_L)/\sqrt 2$ only for balanced designs (at $N_L = 4N_H$ the shortcut turns 5.66σ into
6.71σ).

**GCP.** The Global Consciousness Project
([global-mind.org](https://global-mind.org/science2.html)) has run a network of hardware RNGs
since 1998, testing whether pre-specified "global events" coincide with structure in its output.
Its formal methodology — 200-bit trials at 1 Hz, Stouffer Z across nodes, netvar as the standard
statistic — is documented in [Bancel & Nelson
(2008)](https://global-mind.org/papers/pdf/GCP.Events.Mar08.prepress.pdf), who reported above 4.5σ
over the first 236 formal events. The formal series ran to December 2015, its last event numbered
513; the [results table](https://global-mind.org/results.html) gives a composite Stouffer Z of
7.31 over the 500 rigorously defined events. Formal z-scores normalized each device by its
*empirical* mean and variance ([Nelson & Bancel,
2011](https://doi.org/10.1016/j.explore.2011.08.003)), and the published curves are pointwise;
`analyzeEvent` reproduces both conventions and adds placebo windows and global rank envelopes
([Myllymäki et al., 2017](https://doi.org/10.1111/rssb.12172)) for whole curves. **GCP 2.0**, run
by the HeartMath Institute, calibrates devices by the previous 24 hours; its first, explicitly
exploratory study (Plonka et al., 2026) reports a mean correlation of 0.27 (p < 0.01) between the
Network Coherence of a local 40-RNG tower and of the global network during 15 meditations in 2024.

**The replication debate.** [Bösch, Steinkamp & Boller
(2006)](https://pubmed.ncbi.nlm.nih.gov/16822162/) meta-analyzed 380 intention-RNG studies and
found a tiny, heterogeneous effect whose size–sample-size relation is consistent with publication
bias ([Radin et al. replied](https://pubmed.ncbi.nlm.nih.gov/16822164/)). **Decision augmentation
theory** was proposed for micro-PK experiments generally ([May, Utts & Spottiswoode,
1995](https://thepsifiles.org/paper/may_1995_decision/)): well-timed choices rather than a force
on the device, so where a force predicts $E[z^2] = 1 + \varepsilon^2 n$, decision augmentation
predicts no growth with run length n; [May & Spottiswoode
(2011)](https://www.academia.edu/103257696/The_Global_Consciousness_Project_Identifying_the_Source_of_Psi_A_Response_to_Nelson_and_Bancel)
applied it to the GCP. GCP analyst Peter Bancel concluded after 17 years that the correlations
behave more like goal-oriented experimenter effects than a global field ([Bancel,
2017](https://www.sciencedirect.com/science/article/abs/pii/S1550830716302324)). A new online
experiment with a sequential Bayesian design (n = 12 571) — not a reanalysis — found evidence
*against* micro-PK, BF₀₁ = 10.07 ([Maier, Dechamps & Pflitsch,
2018](https://doi.org/10.3389/fpsyg.2018.00379)).

**Stated plainly:** the MMI hypothesis is contested; the mainstream position is that the
anomalies are best explained by selection effects, publication bias, and analytic flexibility.
These tools enable pre-registered rigor; they cannot produce proof. The package adds what the
critiques demand: hash-chained JSONL recording and replay (the recording *is* the paper trail),
resampling nulls, family-wise corrections, and Bayes factors that can favor chance. The nulls
needed fixing too: in 0.1 the label-shuffle null used circular rotations, degenerate for
alternating target/control designs — about half of all null datasets came out significant at
α = 0.05. It now draws seeded permutations or enumerates relabelings exactly, and an H₀
calibration test over 500 null datasets pins the rejection rate.

## 5. Radionics and Malcolm Rae's base-44 — `@mindpeeker/rate`

Radionics begins with Albert Abrams (1863–1924), whose "Electronic Reactions of Abrams" claimed
disease diagnosis from vibratory rates dialed on proprietary boxes. A joint Scientific American /
AMA investigation (1923–24) concluded the reactions "do not exist … at least objectively. They are
merely products of the Abrams' practitioner's mind"
([Quackwatch](https://quackwatch.org/ncahf/articles/o-r/radionics/)); an AMA member who sent a
practitioner blood from a Plymouth Rock rooster got back a diagnosis of malaria, diabetes, cancer
and syphilis ([Wikipedia](https://en.wikipedia.org/wiki/Albert_Abrams)). In Britain, a committee
chaired by Sir Thomas Horder concluded in 1924 that "the fundamental proposition originally
announced by Dr. Albert Abrams must be regarded as established to a very high degree of
probability" (ark-db library, *Medical Dark Ages* (Hovnanian), p. 139) — but what it validated
were W. E. Boyd's emanometer reaction tests (ark-db library, *Mysteries* (Colin Wilson), p. 562):
the reproducibility of a reaction, not diagnosis or treatment. Chiropractor Ruth Drown (prosecuted
in the US for her instruments) extended the method; a 1950 test of her instrument under AMA
auspices "was completely negative" (ark-db library, *Encyclopedia of Occultism and
Parapsychology*, p. 326). In postwar Britain [George de la
Warr](https://en.wikipedia.org/wiki/George_de_la_Warr) built dial instruments and "radionic
cameras." Radionics has never shown diagnostic or therapeutic efficacy under controlled conditions
([Wikipedia](https://en.wikipedia.org/wiki/Radionics)).

Malcolm Rae is the tradition's most mathematically interesting figure, and most of what is said
about him is web-sourced: nothing in the ark-db library connects him with 44, base 336, or life
dates. The practitioner sites
([radionics.co.uk](http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information);
[Wired Alchemy](https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/)) date him
1913–1979 and report that he asked, by radiesthetic inquiry, what minimum number of dial
calibrations could express "every concept included in the human entity"; the answer was **44**,
and he judged base-44 instruments more effective than base-10 ones, whose dials were calibrated
0–10 or marked 1–10 (Wired Alchemy; ark-db library, *Introduction to Orgone Matrix Material*, p.
39). Practitioner literature also treats rates as instrument-specific: they "will not be the same
number combination on two machines, unless the two machines are identical in componentry" (same,
p. 36). Printed sources do confirm Rae's **Magneto-Geometric cards** — "concentric rings and
radii" (ark-db library, *Secrets in the Fields* (Silva), p. 224), about 24,000 rates (ark-db
library, *Swimming Through The Ether*, p. 4) — where the set of angles *is* the rate. Yvon Combe
later transcribed card patterns into base-10, base-44, and base-336 rate books, but base 336 is
not a radix: Wired Alchemy says its rates use the numbers 1 to 9 and believes they were
computer-generated, while Combe's base-10 rates came from Rae's cards.

`@mindpeeker/rate` keeps these provenance classes apart. **Printed or measured:** the card
structure, and the one-based 1..44 labels of real Combe base-44 rates (65,311 of 65,500 tokens in
the frontend's Combe rate index). **Web-sourced only:** Rae's dates, the choice of 44, the
one-degree angular resolution, and the base-336 convention. **Modeled here:** the digit→angle map
$\theta_d = 2\pi d/44$ (a group homomorphism $\mathbb{Z}_{44} \to S^1$ consistent with, but not
stated by, the sources), one ring per digit, and all stream-modulation protocols. On that geometry
it builds testable mathematics: directional statistics (Mardia & Jupp, 2000), base conversion with
a proven angular error bound of half a target step, card geometry, and deterministic modulation
maps that are explicitly *not* cryptography.

**What remains esoteric claim:** everything radionic — that a card "imprints" a substance, that
a rate acts at a distance or means the same on another instrument, that base-44 has any
significance beyond Rae's dowsing answer. The package asserts none of it. It makes Rae's encoding
*exact and reproducible*, the precondition for subjecting any claim about it to a controlled
test at all.

## 6. Archetypal mapping — `@mindpeeker/oracle`

Divination systems, stripped of interpretation, are **fixed finite sample spaces with canonical
probability models** — good targets for exact implementation, where procedures that look alike can
differ. The three-coin I Ching method gives each line (old yin, young yang, young yin, old yang) =
(1/8, 3/8, 3/8, 1/8); the yarrow-stalk procedure gives (1/16, 5/16, 7/16, 3/16) ([I Ching
divination](https://en.wikipedia.org/wiki/I_Ching_divination); H. Wilhelm, 1957). Both yield
P(yang) = ½, so the primary hexagram is uniform either way, but yarrow moves yang lines three
times as often as yin lines and so changes the relating hexagram. The 16-token, two-coin and
four-coin methods reproduce the yarrow odds exactly; Crowley's one-moving-line method
(`singleLine`) is a third model. A study that conflates them has the wrong null before it begins.

| System | Sample space | Exact probabilities (uniform bytes) | Source |
|---|---|---|---|
| I Ching, one moving line | 64 · 6 = 384 | 1/384 each | Crowley, *Liber CCXVI* |
| Tarot | 78!/(78 − m)! deals; 77 cards after a significator | uniform | Waite (1911) |
| Elder Futhark | 24!/(24 − c)! draws | uniform; merkstave ½ for 15 runes | Gundarsson (1990); Blum (1982) |
| Geomancy | 2¹⁶ shield charts | 1/65 536 | Crowley, *Liber XCVI* (1909) |
| Ifá | 256 odu | 1/256 | Bascom (1969) |
| Sixteen cowries | 17 counts | Binomial(16, ½); 8 up: 12 870/65 536 | Bascom (1980) |
| Kau cim | 100, 78, 60 or 64 lots | 1/n; blocks ½, ¼, ¼ (modeled) | temple practice |
| Tibetan Mo | 36 ordered pairs | 1/36 | Mipham, tr. Goldberg & Dakpa (1990) |
| Astragaloi | faces 1, 3, 4, 6 | 1:4:4:1 of 10, or ¼ (modeled) | attributed to Hagström (1932) |
| Homeromanteion | 216 verse indices | 1/216 | PGM VII.1–148 (Betz, 1986) |

Idealized procedures give the null a pre-registered study can use, not a measurement of real
objects. `celticCrossWaite` deals in Waite's own order (covers, crosses, crowns, beneath, behind,
before, himself, his house, hopes or fears, what will come), with an optional significator
withdrawn first.

`@mindpeeker/oracle` gives three guarantees: **exactness** (rejection sampling instead of modulo
reduction, dyadic Knuth–Yao draws, rejection-sampled Fisher–Yates deals), **determinism** (same
bytes in, same reading out), and **accounting** (every cast reports the bytes and bits it used).
Correctness is verified exhaustively where possible: the geomantic Judge is an even-point figure
in all 65,536 charts, and a companion **parity theorem**, proved and checked over all charts,
shows the points of figures I–XII always sum to an even number, so the Part of Fortune can only
fall on figures II, IV, VI, VIII, X or XII. The public-domain worked chart of *Liber XCVI* is an
end-to-end test vector: bytes `CA 34` reproduce every printed figure, the Judge Populus, and
74 points giving a Part of Fortune on figure II.

**Why bias-free mapping matters.** The naive `value % n` mapping over-represents small residues
by up to one part in ⌊256^k/n⌋ — enormous on the scale of any plausible anomaly (PEAR-scale
effects are parts in 10⁴). With an exact mapping and conditioned input (§1–2), the null for any
symbolic-correlation study is exactly the tabulated distribution, and every deviation is
attributable to the *source or the hypothesis*, never the plumbing. Whether a quantum-sourced
reading is more meaningful than a `Math.random()` one is a question the package deliberately does
not answer.

## 7. Verifiable delay and time bounds — `@mindpeeker/vdf`

A **verifiable delay function** takes a prescribed amount of *sequential* time to evaluate —
parallelism does not help — yet verifies quickly ([Boneh, Bonneau, Bünz & Fisch,
2018](https://eprint.iacr.org/2018/601)). The evaluation is the Rivest–Shamir–Wagner time-lock
puzzle ([1996](https://people.csail.mit.edu/rivest/pubs/RSW96.pdf)), $y = x^{2^T} \bmod N$ by T
squarings in a group of unknown order. Both standard proofs ship:
[Pietrzak's](https://eprint.iacr.org/2018/627) halving protocol sends ⌈log₂ T⌉ midpoints (4366
bytes at T = 5·10⁴, 2048-bit modulus) and verifies with 2⌈log₂ T⌉ exponentiations by 128-bit
exponents; [Wesolowski's](https://eprint.iacr.org/2018/623) proof is one element,
$\pi = x^{\lfloor 2^T/\ell \rfloor}$ for a 256-bit hash-derived prime ℓ (526 bytes for any T), and
verifies about 5× faster, but rests on the stronger adaptive root assumption.

**The group, and a fixed forgery.** Pietrzak's soundness needs a group without low-order
elements, so the package works in the signed quadratic residues $QR_N^+$ ([Hofheinz & Kiltz,
2009](https://doi.org/10.1007/978-3-642-03356-8_37)): elements are canonical representatives
$|a| = \min(a, N - a)$ with an admissible Jacobi symbol. **The 0.1 verifier used raw
representatives, where −1 has order 2, and accepted the negated output N − y** with a re-derived
proof for every non-power-of-two T (and, with sign-flipped midpoints, for powers of two) — two
"verified" outputs for one input. 0.2.0 fixes this and binds the modulus into every hash and the
wire format.

**Assumptions.** Sequentiality of repeated squaring is conjectured, not proven, and collapses if
anyone knows φ(N). The default modulus is
[RSA-2048](https://en.wikipedia.org/wiki/RSA_numbers#RSA-2048) from the RSA Factoring Challenge —
unfactored, with RSA Laboratories stating the primes were generated on an air-gapped machine and
destroyed: a *trust statement, not a proof*, so the modulus is pluggable (`{ n: bigint }`). A
second residual assumption: $QR_N^+$ has no low-order elements when N is a product of safe primes,
but **RSA-2048's primes are not known to be safe**, so the construction relies on low-order
elements being hard to *find* — as hard as factoring for a non-negligible portion of RSA moduli
([Seres & Burcsi, 2020](https://eprint.iacr.org/2020/402)). Chia's proof-of-time does not share
this assumption; it uses class groups, not RSA-2048.

**Wall-clock meaning.** T means T squarings on the fastest hardware anyone owns:

| Hardware | Modulus | Squarings per second | Source |
|---|---|---|---|
| this package (Bun, Apple Silicon) | 2048-bit | ≈ 5·10⁴ | package benchmark |
| optimized CPU code | 2048-bit | 0.48–0.85·10⁶ | [arXiv 2308.01280](https://arxiv.org/abs/2308.01280) |
| FPGA (VDF Alliance, round 1) | 1024-bit | ≈ 4·10⁷ | [Jane Street](https://blog.janestreet.com/really-low-latency-multipliers-and-cryptographic-puzzles/) |

`suggestT(wallMs, { adversarySpeedup: 1000 })` sizes T against FPGA-class hardware, at the
price that local evaluation takes about 1000 times the guarded delay.

**A seal is a lower bound only.** `sealBeacon(pulse, T)` shows that nobody could know y earlier
than ≈ T squarings after the pulse was fixed: a **no-earlier-than** bound. It says nothing about
when y was computed or published, and a beacon value included in a record gives the same kind of
bound. The **no-later-than** bound, "this record existed by time t", needs an external witness
that saw its hash: a later beacon round that committed to it, a transparency-log checkpoint
([C2SP](https://c2sp.org/tlog-checkpoint)), or a Bitcoin attestation via
[OpenTimestamps](https://opentimestamps.org/).

For pre-registration the bounds answer different questions. A no-later-than witness on the
registration hash, obtained before data collection, shows the plan was fixed in advance; no
beacon or VDF can supply that. No-earlier-than bounds protect randomization: assignments derived
from a beacon round published after the registration could not have shaped it, and deriving them
from the seal output y keeps them unknown to everyone for ≈ T squarings. `@mindpeeker/ledger`'s
`TimeBracket` records these pieces — registration hash, beacon anchor, optional VDF seal,
optional `notAfter` witness — and never reports unchecked evidence as verified. A seal does not
make a bad beacon good: if the pulse was predictable, the VDF only delays its consumption.

## 8. Spatial point patterns and the Randonautica lineage — `@mindpeeker/field`

Randonautica-style apps turn random numbers into map coordinates and send people to the densest
spot (an "attractor") or the emptiest one (a "void"). The Fatum Project, from which Randonautica
grew, motivates this with the claim that "if a researcher thinks hard about a certain outcome, the
probability of quantum measurements deviates slightly from the average expected one"
([Fatum theory](https://github.com/anonyhoney/fatum-en/blob/master/docs/fatum_theory.txt)). That is
§4's hypothesis in spatial form. The geometry and the nulls can be computed exactly; the hypothesis
stays a hypothesis.

**The null is complete spatial randomness.** A field drawn from a good RNG is CSR by construction:
n points placed independently and uniformly in a window W of area A. Clustering is its normal state.
Throw 16 darts at 16 squares and each square gets exactly one dart with probability
$16!/16^{16} \approx 1.13 \times 10^{-6}$, while 5.70 squares stay empty on average (ark-db library,
*Fooled by Randomness* (Taleb), pp. 211–212; recomputed here). Every random field has an attractor.
The testable question is whether it is more extreme than the attractors of random fields.

**Classical summaries.** [Clark & Evans (1954)](https://doi.org/10.2307/1931034) divide the mean
nearest-neighbour distance by its CSR expectation $1/(2\sqrt\lambda)$, $\lambda = n/A$; Donnelly's
(1978) edge correction for rectangles adds $(0.0514 + 0.0412/\sqrt n)P/n$ to that expectation, for
perimeter P. Ripley's
K covers all scales ([Ripley, 1977](https://doi.org/10.1111/j.2517-6161.1977.tb01615.x)):
$\lambda K(r)$ is the expected number of further points within r of a typical point, $\pi r^2$ under
CSR, and $L(r) = \sqrt{K(r)/\pi}$. The estimator

$$\hat K(r) = \frac{A}{n(n-1)} \sum_{i \ne j} w_{ij}\, \mathbf 1[d_{ij} \le r]$$

needs edge weights $w_{ij}$: Ripley's isotropic weight (the circumference $2\pi d_{ij}$ of the circle
of radius $d_{ij}$ around $x_i$, divided by the part of it inside W), Ohser's translation weight
$A/\lvert W \cap (W + x_j - x_i)\rvert$, or the border rule, all in closed form for rectangles
([Goreaud & Pélissier, 1999](https://doi.org/10.2307/3237072)). `ripleyK` implements the three with
[spatstat's](https://rdrr.io/cran/spatstat.explore/man/Kest.html) $n(n-1)$ normalisation; 0.1's
`ripleyL` used $A/n^2$ (2 % lower at n = 50) and no edge correction.

**Pointwise versus global envelopes.** The minimum and maximum of $\hat L(r)$ over s simulated CSR
fields form a pointwise band, a test at level about $2/(s+1)$ for one radius chosen in advance.
Reading it across radii is multiple testing
([Loosmore & Ford, 2006](https://doi.org/10.1890/0012-9658(2006)87[1925:SIUTGO]2.0.CO;2);
[Baddeley et al., 2014](https://doi.org/10.1890/13-2042.1)). Over 1000 CSR fields (n = 50, 39
simulations, six radii) the observed curve left the band at the pre-chosen radius in 4.7 % of fields
and at some radius in 14.2 %. The extreme-rank envelope of Myllymäki et al. (2017), one p for all
radii, rejected in 4.5 %, the maximum-absolute-deviation test in 3.1 %. `csrEnvelope` reports both
next to the pointwise band.

**Why a per-point tail is not a field test.** Let $k_i$ count the other points within radius r of
point i. With the disk clipped to the window,

$$\mu_i = (n-1)\,\frac{\lvert B(x_i, r) \cap W\rvert}{A}, \qquad
p_{\text{single}} = P(X \ge k_i), \quad X \sim \mathrm{Binomial}\Big(n-1,\ \frac{\lvert B(x_i, r) \cap W\rvert}{A}\Big).$$

That tail is exact for a neighbourhood chosen before looking. The attractor is the largest of n
dependent counts, chosen after looking: in CSR simulations (a 100 × 80 rectangle, default radius)
its single-point tail was ≤ 0.05 in 58 % of fields at n = 60 and in 100 % at n = 300. The honest
statistic is the whole-field Monte Carlo test ([Besag & Diggle, 1977](https://doi.org/10.2307/2346974)):
compute $T_{\max} = \max_i k_i$ and $T_{\min} = \min_i k_i$ on `runs` CSR fields from the same
sampler and report $p = (1 + \text{number at least as extreme})/(1 + \text{runs})$. Under CSR,
`fieldSignificance` gave an attractor p ≤ 0.05 in 4.0 % of fields at n = 60 and 4.7 % at n = 300,
and a void p ≤ 0.05 in none, since the sparsest point of a random field almost always has zero
neighbours. 0.1 reported Poisson tails with $\mu = n\pi r^2/A$ and no edge correction; its void p was
≤ 0.05 in 88.5 % of CSR fields at n = 60 and in 100 % at n = 300.

**What the Randonaut engines compute.** libAttract, the engine behind Randonautica, publishes its
output schema
([`export_h.h`](https://raw.githubusercontent.com/Wandering-Consciousness/newtonlib/master/libAttract/Export/export_h.h)):
radius, count, mean, power, a "poisson z-score of single random event" with its "exact probability"
(`probability_single`), an `integral_score`, a whole-event `significance`, and rarity tiers from JUNK
to SINGULARITY, which are labels on a z-score, not tests. The open ports differ:
[pyrandonaut](https://github.com/openrandonaut/pyrandonaut) takes the argmax of scipy's
`gaussian_kde` (Silverman bandwidth) on a 100 × 100 grid. `kdeAttractor` reproduces that node
exactly, and `kdeSignificance` adds the rank of the observed maximum among CSR fields, which the
ports never report.

**Scan statistic and the sphere.** [Kulldorff's (1997)](https://doi.org/10.1080/03610929708831995)
circular scan maximises $c\ln(c/E) + (n-c)\ln\big((n-c)/(n-E)\big)$ over circles with
$c > E = n\lvert B \cap W\rvert/A$ and ranks the maximum among simulated fields. On the globe,
`sampleCap` draws exactly area-uniform points in a spherical cap from
$1 - \cos\theta = u\,(1 - \cos(r/R))$ with bearing $2\pi v$, and `sampleLatLonBox` uses
$\varphi = \arcsin\big(\sin\varphi_1 + u(\sin\varphi_2 - \sin\varphi_1)\big)$.

A small whole-field p says the field is unusual under CSR from *this* source, not why; hardware bias
is the first suspect (§2). [Cookbook recipe 5](cookbook.md#5-is-my-field-special) runs the test.

## 9. Radionic scanning, AetherOne and the deviation null — `@mindpeeker/scan`

§5 covered radionic rates. This section covers how rates are *read*, and what a reading is worth.

**From stick pad to random race.** Abrams' Electronic Reactions used two numbered rheostats, for
"rate" and "potentiality", between a blood specimen and a healthy "reagent" whose abdomen was
percussed; Hudgings' 1923 account gives human blood at 49, cancer at 50, tuberculosis at 42 (ark-db
library, *Dr. Abrams and the Electron Theory* (Hudgings), pp. 6–8). Drown replaced the abdomen with a
rubber "stick pad" stroked while potentiometers in series were turned (liver = 48) (ark-db library,
*Swimming Through The Ether*, p. 3); de la Warr's instruments kept the pad, turned until the operator
felt a "sticking" sensation (ark-db library, *Encyclopedia of Occultism and Parapsychology*, 5th ed.,
vol. 1, p. 403). A practitioner manual gives the sweep: every dial to its lowest setting, turn the
first while rubbing the pad, stop at a stick, move on, never watch the dials (ark-db library,
*Introduction to Orgone Matrix Material*, p. 38). No source says how often a stick occurs by chance.

[AetherOnePi](https://github.com/isuretpolos/AetherOnePi) and
[AetherOnePy](https://github.com/isuretpolos/AetherOnePy) replace the stick with random numbers. Read
from their source code, the analysis computes three things:

- **A race.** A random subset of the catalog, in AetherOnePi
  $\min(M, \mathrm{clamp}(\lfloor M/10 \rfloor, 120, 5000))$ of M items, is raced: each pass adds
  a uniform increment (0–9 in AetherOnePi, 0–10 in AetherOnePy) to every item's "energetic value"
  until one reaches the threshold. Earlier positions in a pass finish first (position 0 of 12 wins
  0.118 of races, position 11 only 0.059), so the winner is uniform only because the order is a
  random permutation.
- **General Vitality.** In AetherOnePy, $\mathrm{GV} = \max(d_1, d_2, d_3)$ with $d_i$ uniform on
  0…1000; if GV > 950 (probability $1 - (951/1001)^3 \approx 0.142$), an "explosion" keeps adding
  draws x uniform on 0…100 while $x \ge 50$. AetherOnePi's Auto-Mode broadcasts a rate whose GV
  exceeds 1400; exactly, $P(\mathrm{GV} > 1400) \approx 0.00225$, one rate in 444
  (`generalVitalitySf`).
- **The randomness.** AetherOnePi seeds `java.util.Random` per call from the time and a hotbit seed;
  AetherOnePy seeds Python's `random` from a hotbit. The hardware contributes only each call's seed. scan
  draws every number from the source by rejection sampling and replays byte for byte.

**The deviation null.** Neither number has a stated chance baseline, so scan adds one: each item
gets one fair coin per round (eight per source byte), and its success count after N rounds is
exactly Binomial(N, ½) under H₀. Per item,

$$p_i = P\big(\lvert K - N/2\rvert \ge \lvert k_i - N/2\rvert\big),\quad K \sim \mathrm{Binomial}(N, \tfrac12),
\qquad BF_{10} = \frac{B(k_i + a,\ N - k_i + b)}{B(a, b)}\, 2^N.$$

The exact p never exceeds its level; the normal tail it replaced rejected a fair coin with
probability 0.077 at nominal 0.05 for N = 16. Under a fair source $BF_{10}$ is usually below 1
(median 0.095 at N = 256) and only its mean is exactly 1, so chance can win on the record.

Multiplicity is the central problem: M items at level α give Mα expected false positives, about 25
"significant" items in a 500-item catalog from a perfect coin. Each report carries Bonferroni and
Holm p-values (Holm, 1979), Benjamini–Hochberg q-values
([Benjamini & Hochberg, 1995](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x)), the expected false-positive count,
and an omnibus $\sum_i z_i^2 \approx \chi^2(M)$ test of whether the source is off at all. A
deviation that survives is a fact about the bytes; RF pickup or a biased ADC produce the same fact.

**Controlled tests of radionics.** Four well-documented episodes tested different things:

| Year | Test | Outcome | What it tested |
|---|---|---|---|
| 1923–24 | *Scientific American* and the AMA investigate ERA devices for some ten months ([Quackwatch](https://quackwatch.org/ncahf/articles/o-r/radionics/)) | a senior Abrams associate "got the contents of all six vials completely wrong" ([Wikipedia](https://en.wikipedia.org/wiki/Albert_Abrams)) | diagnosis from specimens |
| 1924 | Horder committee (§5) | "established to a very high degree of probability" | reproducibility of Boyd's emanometer reactions |
| 1950 | Drown's instrument under AMA auspices (§5) | "completely negative" | diagnosis |
| 1960 | a former customer sues de la Warr in the High Court | the judge found for de la Warr but "considered the box to be bogus" ([Wikipedia](https://en.wikipedia.org/wiki/George_de_la_Warr)) | a civil claim, not efficacy |

None is a blinded, randomised test of diagnosis with a stated statistic. For the one part of the
claim a random source can test, that intention biases it, `scanTripolar` runs §4's pre-registered
tripolar protocol with a control arm.

**What `broadcast` does.** It XORs (or phase-modulates, or masks) the entropy stream with the rate
as one continuous keystream, tallies a 1-in-6765 "resonance" per round, and returns a receipt whose
`outputHash` is the SHA-256 of every modulated byte, so a replay can be verified. That is signal
processing plus a receipt: nothing is transmitted, and no effect on any subject is claimed or occurs.
Practitioners themselves call "broadcasting" "descriptive but probably inaccurate, as no radio or
television technology is involved" (ark-db library, *Swimming Through The Ether*, p. 3).
[Cookbook recipe 7](cookbook.md#7-radionic-scan-with-an-honest-null) runs a scan.

## 10. Gematria, isopsephy and numerical coincidence — `@mindpeeker/gematria` and `@mindpeeker/coincidence`

**History.** Where letters were numerals, words had sums. Greek *isopsephy* ("equal pebbles")
compared sums in the Milesian numerals, 24 letters plus digamma 6, koppa 90 and sampi 900. A Pompeii
graffito reads "I love her whose number is 545", and Suetonius records a lampoon in which Νερων (1005)
equals "he killed his own mother" (1005) ([Wikipedia: Isopsephy](https://en.wikipedia.org/wiki/Isopsephy)).
Revelation 13:18 has the reader "count" (ψηφισάτω) the beast's number, χξϛ = 666 (Papyrus 115: χιϛ =
616); Hebrew נרון קסר (Nero Caesar) gives 666 and the Latin-derived נרו קסר gives 616, and scholars
broadly link the number to Nero ([Wikipedia: Number of the beast](https://en.wikipedia.org/wiki/Number_of_the_beast);
values recomputed with the package). Rabbinic gematria reads the 318 servants of Genesis 14:14 as
Eliezer (318) ([Wikipedia: Gematria](https://en.wikipedia.org/wiki/Gematria)). *Sefer Yetzirah*,
dated by most scholars to the Talmudic period, builds a cosmology of 10 sefirot and 22 letters in
three classes: 3 mothers, 7 doubles, 12 simples ([Wikipedia](https://en.wikipedia.org/wiki/Sefer_Yetzirah)).
Mathers (1887) set out gematria, notariqon and temurah with worked equivalences such as Shaddai =
Metatron = 314 (ark-db library, *The Kabbalah Unveiled* (Mathers), p. 13). Crowley and Bennett's
*Sepher Sephiroth* (*The Equinox* I.8, 1912) indexed Hebrew words by value; the package's 191-entry
lexicon transcribes part of it. Among the English ciphers of the calculators, the New Aeon English
Qabalah (A1 L2 W3 …, every eleventh letter) was derived from *Liber AL* by James Lees in 1976
([Wikipedia](https://en.wikipedia.org/wiki/English_Qaballa)).

**What 0.2.0 corrected.** The arithmetic of a letter sum cannot be wrong; the tables can.

- **Achbi and Aibat.** A temurah table is named after its first two pairs, so Achbi is א↔כ, ב↔י.
  Ginsburg (*The Kabbalah*, 1865) lists Aibat (א↔י, ב↔ט) as a different table; 0.1 shipped Aibat as `achbi`.
- **The 22 tziruph tables.** With letters numbered 1…22, table k pairs i with
  $j \equiv k - i \pmod{22}$, a reflection of the letter circle and so an involution. For even k the
  sources support two conventions for the two self-mirrored letters, and both are offered. Albath
  turns רוח into דצע, Mathers' "RVCh … DTzO".
- **Agrippa's Latin key.** *De Occulta Philosophia* II.xx gives A1 … T100, the vowel V = 200, X300,
  Y400, Z500, consonantal I = 600, consonantal V = 700, HI = 800, HV = 900: in modern letters U200,
  J600, V700, W900. 0.1 swapped U and V; the corrected table equals the calculators' "Jewish
  Gematria".
- **Reverse and Arabic.** Mirroring now runs over each cipher's canonical alphabet, so Hebrew finals
  no longer score 0 and reversed Hechrachi is exactly Atbash; an Arabic hamza counts as its seat
  (ؤ → و, ئ → ي), so موسى is 116 (0.1: 106).

**How cheap is an equal value?** If values occur with probabilities $p_v$, two random entries
collide with probability $q = \sum_v p_v^2$ (Rényi-2 entropy $H_2 = -\log_2 q$), n draws hold about
$\binom n2 q$ equal pairs, and after about $\sqrt{2\ln 2/q}$ draws a shared value is likelier than
not. For the bundled Hebrew corpus under Hechrachi, `collisionProfile` gives n = 160, 115 distinct
values, $q = 27/2560$, $H_2 = 6.567$ bits, 55 equal pairs, and a birthday bound of 11.46 (the exact
probabilities are 0.448 for 11 draws and 0.511 for 12). Unevenness makes matches cheaper: ten entries share a value with
probability 0.3845, against 0.3314 if the 115 values were equally likely. That is a theorem:
averaging two probabilities x, y raises $P(\text{all different})$ by
$n!\,\tfrac{(x-y)^2}{4}\,e_{n-2}(\text{rest}) \ge 0$, so equal categories minimise coincidences
(Haigh, 1999).

**The coincidence toolkit.** [Diaconis & Mosteller (1989)](https://doi.org/10.1080/01621459.1989.10478847)
organised the arithmetic: $P(\text{no match}) = \prod_{i<n}(1 - i/c)$, even odds near $1.2\sqrt c$
draws; k-fold matches, where [Levin's (1981)](https://doi.org/10.1214/aos/1176345593) exact method
gives 23, 88 and 187 people for pairs, triples and quadruples of birthdays; near matches (14 people
for birthdays within a day, [Abramson & Moser, 1970](https://doi.org/10.1080/00029890.1970.11992600));
and the law of truly large numbers, "with a large enough sample, any outrageous thing is likely to
happen". Fisher (1924) scored graded card matches as $-\log_{10} P(\text{this grade or better})$,
standardised to mean 0 and SD 10, and the package reproduces his nine printed scores. Kammerer's
*Das Gesetz der Serie* (1919) classified series of coincidences but offered no test;
`seriesClustering` gives an exact one on a window grid fixed in advance.

**The Bible-code episode as the model of honest null testing.** In
[Witztum, Rips & Rosenberg (1994)](https://doi.org/10.1214/ss/1177010393), equidistant letter
sequences of rabbis' names and dates lay close together in Genesis, with an extreme rank in their
permutation test. [McKay, Bar-Natan, Bar-Hillel & Kalai (1999)](https://doi.org/10.1214/ss/1009212243)
traced the result to choices in assembling the lists: lists tuned the same way gave a comparable
result in *War and Peace*. The lesson is a procedure: fix the list first, then compare the observed
agreement with random re-pairings of the same items. `pairMatchTest` applies it to equal values.
Five hand-picked Hebrew pairs of equal value beat every other re-pairing of those words (exact
p = 1/120), which shows only that they were chosen for equal values. The values are exact; what
equal values mean is a contemplative tradition, not a statistical result.
[Cookbook recipe 6](cookbook.md#6-pricing-a-gematria-coincidence) prices a coincidence.

## 11. Scoring the human side of experiments — `@mindpeeker/judging`

RNG experiments score bits. Card guessing, the ganzfeld and remote viewing score people's responses
against targets, and their p-values are valid only under the randomisation the design actually has.
Most classic controversies in this literature were about getting that null wrong.

**Forced choice.** Rhine and Pratt's conventions (*Parapsychology*, 1957): mean chance expectation
np, deviation from it, $SD = \sqrt{npq}$, and a critical ratio CR = deviation/SD read two-sided. A
Zener run is 25 calls at p = ⅕ (SD 2), a dice run 24 throws at ⅙ (SD 1.8257). In the ganzfeld a
receiver picks the target among four clips, so a direct hit has $p_0 = 1/4$ exactly — because the
decoys are the other members of a randomly chosen packet, whatever the receiver's preferences
([Bem & Honorton, 1994](https://doi.org/10.1037/0033-2909.115.1.4);
[Storm, Tressoldi & Di Risio, 2010](https://doi.org/10.1037/a0019457)). `forcedChoiceTest` reports
exact binomial tails, the minimum-likelihood two-sided p, Cohen's h and a Clopper–Pearson interval;
`forcedChoiceBayesFactor` takes $p_0$ as a parameter.

**Closed decks and feedback.** A Zener pack is not 25 independent draws: it holds five cards of each
symbol, shuffled. Matching balanced calls against it has mean 5 but variance 25/6, an SD of 2.0412
rather than 2.000, so the binomial shortcut inflates critical ratios by about 2 % in favour of ESP
([Greville, 1941](https://doi.org/10.1214/aoms/1177731718); ark-db library, *The Theory of Gambling
and Statistical Logic* (Epstein), pp. 420–421). At 9 hits the exact p is 0.0504 and the binomial
gives 0.0468, across the 0.05 line. `closedDeckMatchDistribution` counts all
623 360 743 125 120 orders in integer arithmetic ($P(24) = 0$, $P(25) = 1.604 \times 10^{-15}$).
Feedback changes chance again: a guesser who sees each card after calling and always names the most
represented remaining symbol expects 8.647 hits per pack without any psi
([Read, 1962](https://doi.org/10.1080/00029890.1962.11989919);
[Diaconis & Graham, 1981](https://doi.org/10.1214/aos/1176345329)).

**Displacement and choosing afterwards.** Scoring each call against the previous and next target as
well gives three looks at the same data. Picking the best of the offsets −1, 0 and +1 after seeing
the data raises the expected hits per Zener run from 5 to 6.74 (ark-db library, *The Theory of
Gambling and Statistical Logic* (Epstein), p. 422). Pooled displacement scores also need the
variance of overlapping comparisons, the substance of Bartlett's objection to Soal: for Soal's
pattern counts the exact variance is 872.00, against 934.4 from the binomial formula. Soal's data
were later shown to have been manipulated (Markwick, 1978), so the package encodes his design and
its null, not his results.

**Rank-order judging.** In free-response designs a judge ranks the true target among k candidates
(1 = best match). Under the null each rank is uniform on 1…k, with mean $(k+1)/2$ and variance
$(k^2-1)/12$; Utts' per-trial effect size is $\big((k+1)/2 - \bar r\big)/\sqrt{(k^2-1)/12}$
([Utts, 1991](https://doi.org/10.1214/ss/1177011577)). The sum of n ranks has an exact null, the
n-fold convolution of the discrete uniform (Solfvin, Kelly & Burdick, 1978). In the SRI design a
judge rank-orders six transcripts against six targets. The exact test counts how many of the k!
pairings score at least as well as the true one; it needs no independence between the judge's
rows, only a random pairing. May et al.'s (1990) figure of merit (accuracy × reliability over
descriptor sets) gets its null by ranking the target's score among decoys. Critics attacked the
design rather than the arithmetic: [Marks & Kammann (1978)](https://doi.org/10.1038/274680a0) found
cues in unedited SRI transcripts. Direct hits and ranks are both valid scores; reporting whichever
looks better is another multiplicity error, so the registration has to pick one.

**Many looks and optional stopping.** Reporting the best of I analyses inflates the statistic under
the null. The expected maximum of I independent standard normals is 1.54 for I = 10 and 1.87 for
I = 20, and the best of 20 must beat z = 2.80 for a family-wise α of 0.05 (Šidák's correction;
Bailey & López de Prado's deflated threshold). Stopping when a series looks good is the sequential
form of the same error. By the law of the iterated logarithm a fixed critical ratio is eventually
crossed with probability one; for a ganzfeld series tested after every session from 10 to 200 at
$p_0 = 1/4$, `optionalStoppingRisk` gives an exact 0.215 chance of a false rejection at nominal 0.05.
Bayes factors with a fixed prior and the e-processes of §2 and §4 keep their level under continuous
monitoring when a rejection means crossing $1/\alpha$.

None of this establishes or refutes psi. A small p-value is a fact about calls versus targets under
the design's null. It becomes evidence only if targets were drawn after the responses were fixed,
judging was blind, feedback did not change the null, and the scoring rule was registered.
[Cookbook recipe 8](cookbook.md#8-scoring-forced-choice-studies) scores a study end to end.

## 12. Time, sky and environmental correlates — `@mindpeeker/ephemeris`

Some hypotheses about anomalous cognition name a physical covariate: time of day, season, the Moon,
geomagnetic activity, or local sidereal time (LST), the right ascension on the observer's meridian,
that is, which strip of sky is overhead. The astronomy is exact to a stated precision. The
hypotheses are contested.

**Exact sidereal time.** With $D = \mathrm{JD} - 2451545$ days from J2000 and $T = D/36525$,
Greenwich mean sidereal time in degrees is

$$\theta_0 = 280.46061837 + 360.98564736629\,D + 0.000387933\,T^2 - T^3/38\,710\,000$$

(Meeus, *Astronomical Algorithms*, eq. 12.4, IAU 1982). Apparent sidereal time adds the equation of
the equinoxes ([USNO](https://aa.usno.navy.mil/faq/GAST)), and
$\mathrm{LST} = \mathrm{GMST} + \lambda/15$ hours for east longitude λ in degrees. A sidereal day is
about 3 min 56 s shorter than a solar day, so a fixed clock time moves through every sidereal hour
over a year. The package's GMST
agrees with ERFA's `gmst82` to 0.07 ms, and its Moon (the full Meeus ch. 47 tables) stays within
10.5″ of JPL DE440s over 1900–2100.

**The Spottiswoode claim.** Spottiswoode (1997) binned 1,468 free-response trials from 21 studies by
LST. The overall effect size was 0.148, while trials within ±1 h of 13.47 h LST averaged 0.507
(n = 83), a gain of 3.42. A validation set of 1,015 trials peaked at the same place (gain 4.51 within
±1 h, n = 43, one-tailed p = 0.05). The method was a 2-hour window moved in 0.1-hour steps over data
padded with copies at ±24 h, plus a permutation test that shuffled effect sizes against times and
recomputed every window: for the combined 2,483 trials, 14 of 10,000 shuffles produced a window
mean at least as large. A 1998 follow-up on 2,879 trials found the geomagnetic ap index correlated
with effect size only inside the band, ρ = −0.192 at 11.2–14.8 h LST (N = 256) against −0.010
outside (N = 2,623). Both papers are reprinted in McMoneagle, *Remote Viewing Secrets* (2000), App. B,
pp. 228–238, and App. C, pp. 247–248.

**The seasonal confound.** LST is a linear function of local solar time and day of the year, so any
effect that depends on clock time and season can surface as an LST effect. Spottiswoode checked clock
time: removing the means of 1-hour clock-time bins left the LST plot "virtually indistinguishable"
(App. B, p. 236). He named the remaining alternative himself: "some undiscovered systematic
relationship between effect size and these variables might be responsible for the observed peak"
(p. 238). Most trials ran in daylight hours, so a seasonal factor becomes an LST variation, and
Sturrock & Spottiswoode (2007) found a seasonal variation in the same database which, in Ryan's
words, "will, at least partly, explain the shape of the LST graph" (Ryan, 2008, p. 337). In fresh
data, Ryan & Spottiswoode (2015) saw sidereal structure again but with the peak moved from 13:30 to
08:30 LST ([SPR Psi Encyclopedia](https://psi-encyclopedia.spr.ac.uk/articles/adrian-ryan)).

**Why the peak search belongs inside the null.** The 13.47 h window was found by scanning 240
windows of the first data set, so testing that window on the same data ignores the search. Measured
here on 1000 null data sets (300 trials each, uniform LST, Gaussian effects, 999 permutations): a
permutation test of the ±1 h window around each data set's own peak rejected at p ≤ 0.05 in 90.1 %
of them, while `lstPermutationTest`, which repeats the whole scan for every relabelling, rejected in
4.5 %. Spottiswoode's own Monte Carlo did recompute every window per shuffle; the package reports the
add-one estimate $(1 + b)/(1 + m)$, 15/10,001 for his count. For confirmation, `lstWindowTest` tests
one window registered before new data exist. A `stratum` restricts relabelling to trials of the same
study or the same clock-time and season cell, so study mix and season cannot pass as LST: in the
package's tests an unstratified null rejected in more than 90 % of simulated study mixes without any
LST effect, the stratified null in about 5 %.

**Geomagnetic claims, stated as contested.** The ap correlation appears only inside the LST band and
was found retrospectively. Spottiswoode himself doubted that geomagnetic fluctuations act directly:
typical disturbances of 50–200 nT are small next to the field changes a person meets moving through
urban buildings, so "it is likely that the correlation with anomalous cognition reported here is due
to some other parameter" of the Sun–Earth interaction (App. C, p. 252). Across 6,000 trials, Ryan &
Spottiswoode (2015) found no significant overall correlation with geomagnetic activity. The package
ships no geomagnetic data; a caller who joins trials to published indices should use the same
stratified permutation logic. [Cookbook recipe 9](cookbook.md#9-local-sidereal-time-scan) runs the
scan.

## 13. Integrity: registrations, hash chains and time brackets — `@mindpeeker/ledger`, psi recordings, `@mindpeeker/vdf`

Was the analysis fixed before the data? Were records edited? Could anyone predict the
randomisation? No statistic answers these, but cryptography answers narrower versions exactly, where
procedures fail silently. The Transparent Psi Project planned to sync its data-collection software to
GitLab in real time and to keep server access logs; its correction reports that only the software's
starting state reached GitLab and that a misconfigured log was overwritten every few days
([Kekecs et al., 2023](https://doi.org/10.1098/rsos.191375);
[correction](https://doi.org/10.1098/rsos.231080)).

**Canonical JSON and registrations.** A registration hash must not depend on key order, whitespace
or number formatting, which [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) fixes. Values JSON
cannot represent losslessly must be rejected, not coerced: 0.1's `canonicalJson` wrote a Date as its
ISO string and a Map as `{}`, so different configurations could share a hash. The ledger's
registration follows the fields of the
[Koestler Parapsychology Unit registry](https://koestlerunit.wordpress.com/study-registry/)
(confirmatory and exploratory hypotheses with statistic, null and direction; α and correction; a
fixed or sequential sample plan; the analysis-plan hash; exclusions; data sources) and hashes the
envelope `{ schema, registration }`.

**Hash chains.** Line i is the canonical `{ i, prev, record }`, with $\mathrm{prev}_0$ the genesis
(the registration hash, or 64 zeros) and $\mathrm{prev}_i = \mathrm{SHA256}(\mathrm{line}_{i-1})$;
the head is the hash of the last line. Editing, inserting, deleting or reordering a line breaks the
next link ([Schneier & Kelsey, 1999](https://doi.org/10.1145/317087.317089);
[Crosby & Wallach, 2009](https://www.usenix.org/legacy/event/sec09/tech/full_papers/crosby.pdf)).
A truncated tail, or a chain fabricated whole, shows only against a head published or timestamped
earlier. psi's JSONL schema v2 is such a chain, a session header followed by trial lines whose
`prev` hashes the previous line's exact text; the ledger's `verifyChain(lines, { format: 'psi' })`
returns the same head as psi's own verifier, and the visualizer's `--replay` refuses a broken chain.

**Merkle trees.** To prove that one line is in a large log without shipping the log,
[RFC 6962](https://www.rfc-editor.org/rfc/rfc6962) hashes leaves and nodes with distinct prefixes,

$$\mathrm{leaf}(d) = \mathrm{SHA256}(\mathtt{0x00} \mathbin\Vert d), \qquad
\mathrm{node}(L, R) = \mathrm{SHA256}(\mathtt{0x01} \mathbin\Vert L \mathbin\Vert R),$$

so a leaf cannot pass as a node. An inclusion proof is at most $\lceil\log_2 n\rceil$ sibling hashes;
a consistency proof shows that a tree of size n extends one of size m, so the log is append-only
([RFC 9162](https://www.rfc-editor.org/rfc/rfc9162) §2.1). A proof does not authenticate the tree
size (index 0 verifies alike in trees of 13 and 14 leaves), so size and root should come from a signed
[C2SP checkpoint](https://c2sp.org/tlog-checkpoint), and checkpoints collected over time should be
checked for consistency, because a signer can sign a fork.

**Commit–reveal.** Parties who distrust each other each commit
$c = \mathrm{SHA256}(\text{domain} \mathbin\Vert \mathrm{LP}(v) \mathbin\Vert \mathrm{LP}(r))$ to a
value v with a nonce r of at least 16 bytes, reveal after a deadline, and XOR the reveals
([Blum, 1983](https://doi.org/10.1145/1008908.1008911)): one honest uniform share makes the seed
uniform. The weakness is the last revealer, who knows the outcome and can refuse to open, forcing a
restart that XOR cannot undo. Deriving the seed from a beacon round published after the reveal
deadline (the pattern of NIST IR 8213 §7.2), or sealing the reveals with a VDF, removes the
advantage.

**Two directions in time.** No single mechanism bounds a record from both sides:

| Evidence | Bound | What it trusts |
|---|---|---|
| beacon value inside the record | no earlier than the round's publication | a genuine value (fetch it yourself) that nobody could predict; drand: a 3 s round from a threshold of League of Entropy operators; NIST: a 60 s pulse from one operator |
| VDF seal over the record | no earlier than ≈ T squarings after the input was fixed | sequential squaring, an unfactored modulus, the fastest hardware anyone owns (§7) |
| transparency-log inclusion (C2SP checkpoint, [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/)) | no later than the signed checkpoint | the log operator and its witnesses, with consistent checkpoints |
| [OpenTimestamps](https://opentimestamps.org/) attestation | no later than the Bitcoin block | Bitcoin consensus; block times are loose by about two hours, confirmation takes hours |
| a later beacon round that committed to the hash | no later than that round | the beacon operator |

`TimeBracket` records a registration hash, a beacon anchor, an optional Pietrzak seal and an optional
no-later-than reference. `verifyTimeBracket` compares the beacon with values the verifier fetched
independently, runs caller-supplied hooks for seal and witness, and reports anything unchecked as
`unverified`. The ledger has no network code, so the trust in each outside party stays visible.

For a pre-registered study the halves answer different questions (§7): a no-later-than witness on
the registration hash, obtained before data collection, shows the plan came first; a no-earlier-than
bound on beacon-derived assignments shows they could not have shaped the plan. Neither shows that
data came from where they claim or that a hypothesis is true, and a self-hosted chain is not an
independent registry: publish hashes and heads where you cannot rewrite them. Cookbook recipes
[2](cookbook.md#2-pre-registered-tripolar-run-with-a-control-arm) and
[11](cookbook.md#11-tamper-evident-log-with-merkle-proofs) combine the pieces.

## 14. The bridge: how the stack composes, and what would count as evidence

**Composition.** The fifteen packages form a pipeline with an integrity spine:

- **Source:** `@mindpeeker/entropy` produces health-tested bytes with honest provenance
  (quantum / classical / algorithmic / public), streamed as `AsyncIterable<Uint8Array>`, plus a
  seeded HMAC_DRBG that replays byte-exactly as a control.
- **Detection:** `@mindpeeker/negentropy` measures order in a stream and runs registered, anytime-valid
  sessions; `@mindpeeker/flow` measures directed coupling *between* streams; `@mindpeeker/field`
  looks for order in space against complete spatial randomness.
- **Protocols:** `@mindpeeker/psi` wraps negentropy's statistics in the field's canonical experiment
  protocols with recording, replay, surrogates and Bayes factors; `@mindpeeker/scan` rebuilds
  radionic scanning and broadcasting on top, with an exact per-item null and multiplicity control.
- **Scoring and pricing:** `@mindpeeker/judging` gives exact nulls for human responses (forced
  choice, closed decks, feedback, ranks, displacement, optional stopping); `@mindpeeker/coincidence`
  prices matches (birthday generalisations, Fisher's scores, seriality).
- **Symbolic layer:** `@mindpeeker/oracle` spends conditioned bits into exactly distributed
  archetypal readings; `@mindpeeker/gematria` computes exact letter values, temurah and the collision
  statistics of equal values; `@mindpeeker/rate` renders radionic encodings exact and reproducible.
  All three are mappings with guarantees, not claims with mechanisms.
- **Covariates:** `@mindpeeker/ephemeris` supplies Julian days, sidereal time, the Sun and the Moon,
  and a sidereal-time scan whose null includes its own search.
- **Integrity:** `@mindpeeker/ledger` provides canonical registrations, hash chains, Merkle proofs,
  commit–reveal and time brackets; `@mindpeeker/vdf` seals give no-earlier-than bounds. The
  no-later-than side needs an external witness (§13).
- **Observation:** `@mindpeeker/visualizer` renders live noise, statistic series with pointwise and
  anytime-valid bands, matrices and rate cards, and records and replays hash-chained trials —
  because *watching* many windows is not *claiming* any of them.

Packages meet through shared shapes and conventions (a stream shape, MSB-first bits, canonical
JSON, one seeded PRNG stream across psi, judging and ephemeris, deterministic replay), so the honest
separation survives composition: no statistical result acquires a metaphysical interpretation by
passing through another package.

**Epistemics: what would constitute evidence.** For the contested hypotheses this stack can be
pointed at, a persuasive result would need, at minimum:

1. **Pre-registration with cryptographic teeth** — hypothesis, statistic, window, correction, sample
   size or stopping rule, scoring rule (direct hits or ranks), what counts as a coincidence, and the
   seeds of every permutation, all frozen before data collection (`registerExperiment`,
   `registerTripolar`, the ledger's `registrationHash`); the registration hash witnessed no later
   than the start of data collection, and beacon-derived assignments bounded no earlier than the
   registration (a ledger time bracket, §13). Without a registered n, only an anytime-valid design
   keeps its stated level (§2, §11).
2. **Adequate power for honest effect sizes.** PEAR-scale effects are ε ≈ 10⁻⁴ per bit. Since
   z ≈ ε√N, a 5σ detection requires N ≈ (5/10⁻⁴)² = 2.5 × 10⁹ bits — about 145 days of one
   GCP-convention node at 200 bits/s. Underpowered "null results" and lucky small samples are
   both uninformative.
3. **Physical controls.** A yoked control arm drawn from a seeded `drbgProvider`, so it replays
   byte-exactly, contrasted with the experimental arm (`controlContrast`) and tested for
   equivalence at a pre-registered bound (`tostEquivalence`), so the control can positively
   support "no effect" — plus source swaps, shielding variations, and TE independence checks
   between hardware channels (§3).
4. **The null the design actually has.** Closed decks, trial-by-trial feedback and the chance rate of
   the forced-choice design for human responses (§11); the lexicon's own value histogram for equal
   values (§10); relabelling within studies and seasons for time-of-day covariates (§12).
5. **Family-wise honesty.** Surrogate or placebo-window nulls for every claim extracted from a
   monitored stream (`timeOffsetSurrogates`, `placeboWindows`); global envelopes for whole curves,
   over time (`globalRankEnvelope`) and over radii (`csrEnvelope`); whole-field p-values instead of
   per-point tails (§8); adjusted p-values for catalog scans (§9); every peak search inside its
   permutation null (§12); anytime-valid monitoring (§2) for anyone who watches live. Pointwise
   envelopes are never presented as path-wise.
6. **Evidence-symmetric statistics.** Bayes factors, at the chance rate the design actually
   has, reported alongside p-values, so chance can win on the record.
7. **Independent replication from raw data** — byte-exact, hash-chained JSONL recordings
   published with their head hash and, for large logs, signed Merkle checkpoints, so critics rerun
   the exact pipeline and detect any edit; replication by adversarial collaborators weighted above
   replication by proponents (the lesson of the PEAR consortium, the Bösch meta-analysis and the
   Bible-code debate).

Nothing in this workspace settles the underlying questions, and no single session on your own
hardware will either. What the stack guarantees is narrower and worth having: exact mathematics,
honest nulls, reproducible pipelines, and a paper trail that makes both positive and negative
results *mean something*.

---

## References

**Standards and randomness engineering**

- NIST SP 800-90A Rev. 1, *Recommendation for Random Number Generation Using Deterministic
  Random Bit Generators* (2015). https://csrc.nist.gov/pubs/sp/800/90/a/r1/final
- NIST SP 800-90B, *Recommendation for the Entropy Sources Used for Random Bit Generation*
  (2018). https://csrc.nist.gov/pubs/sp/800/90/b/final
- NIST SP 800-90C, *Recommendation for Random Bit Generator (RBG) Constructions* (2025).
  https://csrc.nist.gov/pubs/sp/800/90/c/final
- NIST SP 800-22 Rev. 1a, *A Statistical Test Suite for Random and Pseudorandom Number
  Generators for Cryptographic Applications* (2010).
  https://csrc.nist.gov/pubs/sp/800/22/r1/upd1/final
- Kim, S.-J., Umeno, K. & Hasegawa, A. "Corrections of the NIST Statistical Test Suite for
  Randomness." IACR ePrint 2004/018 (2004). https://eprint.iacr.org/2004/018
- NIST IR 8213 (initial public draft), *A Reference for Randomness Beacons: Format and
  Protocol Version 2*. https://csrc.nist.gov/pubs/ir/8213/ipd
- NIST Interoperable Randomness Beacons project.
  https://csrc.nist.gov/projects/interoperable-randomness-beacons
- drand / League of Entropy. https://drand.love/

**Negentropy, estimation and sequential testing**

- Schrödinger, E. *What is Life?* Cambridge University Press (1944).
- Brillouin, L. "The Negentropy Principle of Information." *Journal of Applied Physics* 24,
  1152–1163 (1953). https://doi.org/10.1063/1.1721463
- Ho, M.-W. *The Rainbow and the Worm: The Physics of Organisms* — ark-db library, p. 84.
- Pepperell, R. *The Posthuman Condition: Consciousness Beyond the Brain* — ark-db library, p. 67.
- Hyvärinen, A. "New Approximations of Differential Entropy for Independent Component Analysis
  and Projection Pursuit." *Advances in Neural Information Processing Systems 10* (1998).
- Vasicek, O. "A Test for Normality Based on Sample Entropy." *Journal of the Royal
  Statistical Society B* 38(1), 54–59 (1976).
- Plonka, N., Davies, S., Atkinson, M., Crowe, K., Dispenza, J. & McCraty, R. "Correlations
  between onsite and global networks of random number generators during group healing
  meditations." *Explore* 22(2), 103312 (2026). https://doi.org/10.1016/j.explore.2025.103312
- Ville, J. *Étude critique de la notion de collectif.* Gauthier-Villars (1939).
- Robbins, H. "Statistical Methods Related to the Law of the Iterated Logarithm." *Annals of
  Mathematical Statistics* 41(5), 1397–1409 (1970). https://doi.org/10.1214/aoms/1177696786
- Shafer, G., Shen, A., Vereshchagin, N. & Vovk, V. "Test Martingales, Bayes Factors and
  p-Values." *Statistical Science* 26(1) (2011). https://doi.org/10.1214/10-STS347
- Howard, S., Ramdas, A., McAuliffe, J. & Sekhon, J. "Time-uniform, nonparametric,
  nonasymptotic confidence sequences." *Annals of Statistics* 49(2) (2021).
  https://doi.org/10.1214/20-AOS1991
- Epstein, R. A. *The Theory of Gambling and Statistical Logic*, ch. 11 (closed-deck Zener
  distribution, displacement, optional stopping and the law of the iterated logarithm) — ark-db
  library, pp. 420–423.

**Information flow**

- Schreiber, T. "Measuring Information Transfer." *Physical Review Letters* 85, 461–464
  (2000). https://doi.org/10.1103/PhysRevLett.85.461
- Massey, J. "Causality, Feedback and Directed Information." *Proc. International Symposium on
  Information Theory and its Applications* (1990).
- Lizier, J., Prokopenko, M. & Zomaya, A. "Local information transfer as a spatiotemporal
  filter for complex systems." *Physical Review E* 77, 026110 (2008).
  https://doi.org/10.1103/PhysRevE.77.026110
- Lizier, J., Prokopenko, M. & Zomaya, A. "Local measures of information storage in complex
  distributed computation." *Information Sciences* 208, 39–54 (2012).
  https://doi.org/10.1016/j.ins.2012.04.016
- Barnett, L. & Bossomaier, T. "Transfer Entropy as a Log-Likelihood Ratio." *Physical Review
  Letters* 109, 138105 (2012). https://doi.org/10.1103/PhysRevLett.109.138105
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
  https://www.pear-lab.com/pdfs/1997-correlations-random-binary-sequences-12-year-review.pdf
- Jahn, R. et al. "Mind/Machine Interaction Consortium: PortREG Replication Experiments."
  *Journal of Scientific Exploration* 14(4), 499–555 (2000).
  http://icrl.org/wp-content/uploads/2020/02/2000-mmi-consortium-portreg-replication.pdf
- Mishlove, J. *The Roots of Consciousness* (revised ed.) — ark-db library, p. 312.
- Nelson, R. et al. — Global Consciousness Project methodology. https://global-mind.org/science2.html
- Global Consciousness Project — formal results table. https://global-mind.org/results.html
- Bancel, P. & Nelson, R. "The GCP Event Experiment: Design, Analytical Methods, Results."
  *Journal of Scientific Exploration* 22(3) (2008).
  https://global-mind.org/papers/pdf/GCP.Events.Mar08.prepress.pdf
- Nelson, R. & Bancel, P. "Effects of Mass Consciousness: Changes in Random Data during Global
  Events." *Explore* 7, 373–383 (2011). https://doi.org/10.1016/j.explore.2011.08.003
- Myllymäki, M., Mrkvička, T., Grabarnik, P., Seijo, H. & Hahn, U. "Global Envelope Tests for
  Spatial Processes." *Journal of the Royal Statistical Society B* 79(2), 381–404 (2017).
  https://doi.org/10.1111/rssb.12172
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
- Maier, M., Dechamps, M. & Pflitsch, M. "Intentional Observer Effects on Quantum Randomness:
  A Bayesian Analysis Reveals Evidence Against Micro-Psychokinesis." *Frontiers in Psychology*
  9, 379 (2018). https://doi.org/10.3389/fpsyg.2018.00379

**Radionics, Malcolm Rae and radionic scanning**

- Barrett, S. "Radionics and Albert Abrams, M.D." Quackwatch.
  https://quackwatch.org/ncahf/articles/o-r/radionics/
- Wikipedia: Albert Abrams (the *Scientific American* investigation; the rooster-blood diagnosis).
  https://en.wikipedia.org/wiki/Albert_Abrams
- Hudgings, W. F. *Dr. Abrams and the Electron Theory* (1923; ERA rheostats and rates) — ark-db
  library, pp. 6–8.
- Hovnanian, R. R. *Medical Dark Ages* (quoting the Horder committee, 1924) — ark-db library,
  p. 139.
- Wilson, C. *Mysteries* (Boyd's 1924 experiments and the Horder committee) — ark-db library,
  p. 562.
- Melton, J. G. (ed.) *Encyclopedia of Occultism and Parapsychology*, 5th ed., "Radionics"
  (Drown's 1950 AMA test) — ark-db library, p. 326; vol. 1, "De La Warr, George" (the stroked
  rubber detector) — ark-db library, p. 403.
- *Introduction to Orgone Matrix Material* (practitioner manual: dial marking, the dial sweep,
  instrument-specific rates) — ark-db library, pp. 36, 38, 39.
- Silva, F. *Secrets in the Fields* (Rae's cards) — ark-db library, p. 224.
- *Swimming Through The Ether — Notes on Homoeopathy & Radionics* (Drown's stick pad,
  "broadcasting", Rae's ~24,000 card rates) — ark-db library, pp. 3–4.
- Wikipedia: Radionics. https://en.wikipedia.org/wiki/Radionics
- Wikipedia: George de la Warr. https://en.wikipedia.org/wiki/George_de_la_Warr
- radionics.co.uk — MGA-Rae information.
  http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information
- Wired Alchemy — "The 10, the 44, and the 336."
  https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/
- Wired Alchemy — Malcolm Rae MGA cards.
  https://wiredalchemy.com/radionic-rates-dials/malcolm-rae-cards/
- Mardia, K.V. & Jupp, P.E. *Directional Statistics.* Wiley (2000).
- AetherOnePi (isuretpolos). https://github.com/isuretpolos/AetherOnePi
- AetherOnePy (isuretpolos). https://github.com/isuretpolos/AetherOnePy
- Holm, S. "A Simple Sequentially Rejective Multiple Test Procedure." *Scandinavian Journal of
  Statistics* 6, 65–70 (1979).
- Benjamini, Y. & Hochberg, Y. "Controlling the False Discovery Rate: A Practical and Powerful
  Approach to Multiple Testing." *Journal of the Royal Statistical Society B* 57, 289–300 (1995).
  https://doi.org/10.1111/j.2517-6161.1995.tb02031.x

**Archetypal systems**

- Wikipedia: I Ching divination (yarrow vs coin probabilities).
  https://en.wikipedia.org/wiki/I_Ching_divination
- Legge, J. (tr.) *The Yî King*, Sacred Books of the East XVI (1882; 2nd ed. 1899), Great
  Appendix I.9.
- Wilhelm, H. "The Concept of Time in the Book of Changes." In *Man and Time* (1957).
- Crowley, A. *Liber XCVI, A Handbook of Geomancy*, *The Equinox* I:2 (1909); *Liber CCXVI*.
- Waite, A. E. *The Pictorial Key to the Tarot* (1911).
- Gundarsson, K. *Teutonic Magic* (1990); Blum, R. *The Book of Runes* (1982).
- Bascom, W. *Ifa Divination: Communication between Gods and Men in West Africa*, Indiana
  University Press (1969); *Sixteen Cowries: Yoruba Divination from Africa to the New World*,
  Indiana University Press (1980).
- Mipham, J., tr. Goldberg, J. & Dakpa, N. *Mo: Tibetan Divination System* (1990).
- Betz, H. D. (ed.) *The Greek Magical Papyri in Translation*, PGM VII.1–148 (1986).
- Knuth, D. & Yao, A. "The Complexity of Nonuniform Random Number Generation." In *Algorithms
  and Complexity: New Directions and Recent Results* (1976).
- Knuth, D. *The Art of Computer Programming*, Vol. 2, Algorithm 3.4.2P (Fisher–Yates).

**Verifiable delay functions and timestamps**

- Pietrzak, K. "Simple Verifiable Delay Functions." *ITCS 2019*.
  https://eprint.iacr.org/2018/627
- Wesolowski, B. "Efficient verifiable delay functions." *EUROCRYPT 2019*.
  https://eprint.iacr.org/2018/623
- Boneh, D., Bonneau, J., Bünz, B. & Fisch, B. "Verifiable Delay Functions." *CRYPTO 2018*.
  https://eprint.iacr.org/2018/601
- Boneh, D., Bünz, B. & Fisch, B. "A Survey of Two Verifiable Delay Functions." (2018).
  https://eprint.iacr.org/2018/712
- Hofheinz, D. & Kiltz, E. "The Group of Signed Quadratic Residues and Applications." *CRYPTO
  2009*, 637–653. https://doi.org/10.1007/978-3-642-03356-8_37
- Seres, I. A. & Burcsi, P. "A Note on Low Order Assumptions in RSA groups." IACR ePrint
  2020/402 (2020). https://eprint.iacr.org/2020/402
- Rivest, R., Shamir, A. & Wagner, D. "Time-lock puzzles and timed-release Crypto." MIT/LCS
  (1996). https://people.csail.mit.edu/rivest/pubs/RSW96.pdf
- Abadi, A., Ristea, D., Grigor, A. & Murdoch, S. J. "Scalable Time-Lock Puzzle."
  arXiv:2308.01280. https://arxiv.org/abs/2308.01280
- Jane Street. "Really low latency multipliers and cryptographic puzzles."
  https://blog.janestreet.com/really-low-latency-multipliers-and-cryptographic-puzzles/
- C2SP. "tlog-checkpoint." https://c2sp.org/tlog-checkpoint
- OpenTimestamps. https://opentimestamps.org/
- Wikipedia: RSA numbers — RSA-2048. https://en.wikipedia.org/wiki/RSA_numbers#RSA-2048

**Spatial point patterns and Randonautica**

- Clark, P. J. & Evans, F. C. "Distance to Nearest Neighbor as a Measure of Spatial Relationships
  in Populations." *Ecology* 35, 445–453 (1954). https://doi.org/10.2307/1931034
- Donnelly, K. "Simulations to determine the variance and edge-effect of total nearest neighbour
  distance." In Hodder, I. (ed.) *Simulation Studies in Archaeology*, Cambridge University Press,
  91–95 (1978).
- Ripley, B. D. "Modelling Spatial Patterns." *Journal of the Royal Statistical Society B* 39,
  172–192 (1977). https://doi.org/10.1111/j.2517-6161.1977.tb01615.x
- Besag, J. & Diggle, P. J. "Simple Monte Carlo Tests for Spatial Pattern." *Applied Statistics*
  26, 327–333 (1977). https://doi.org/10.2307/2346974
- Goreaud, F. & Pélissier, R. "On explicit formulas of edge effect correction for Ripley's
  K-function." *Journal of Vegetation Science* 10, 433–438 (1999). https://doi.org/10.2307/3237072
- Loosmore, N. B. & Ford, E. D. "Statistical inference using the G or K point pattern spatial
  statistics." *Ecology* 87, 1925–1931 (2006).
  https://doi.org/10.1890/0012-9658(2006)87[1925:SIUTGO]2.0.CO;2
- Baddeley, A., Diggle, P. J., Hardegen, A., Lawrence, T., Milne, R. K. & Nair, G. "On tests of
  spatial pattern based on simulation envelopes." *Ecological Monographs* 84, 477–489 (2014).
  https://doi.org/10.1890/13-2042.1
- Kulldorff, M. "A spatial scan statistic." *Communications in Statistics — Theory and Methods* 26,
  1481–1496 (1997). https://doi.org/10.1080/03610929708831995
- Baddeley, A., Rubak, E. & Turner, R. *Spatial Point Patterns: Methodology and Applications with
  R.* CRC Press (2015); spatstat `Kest`. https://rdrr.io/cran/spatstat.explore/man/Kest.html
- Taleb, N. N. *Fooled by Randomness* (chance clustering on a grid) — ark-db library, pp. 211–212.
- Fatum Project — theory document. https://github.com/anonyhoney/fatum-en/blob/master/docs/fatum_theory.txt
- libAttract output schema (`export_h.h`), newtonlib.
  https://raw.githubusercontent.com/Wandering-Consciousness/newtonlib/master/libAttract/Export/export_h.h
- pyrandonaut (openrandonaut). https://github.com/openrandonaut/pyrandonaut

**Gematria, isopsephy and coincidence**

- Wikipedia: Isopsephy. https://en.wikipedia.org/wiki/Isopsephy
- Wikipedia: Number of the beast. https://en.wikipedia.org/wiki/Number_of_the_beast
- Wikipedia: Gematria. https://en.wikipedia.org/wiki/Gematria
- Wikipedia: Sefer Yetzirah. https://en.wikipedia.org/wiki/Sefer_Yetzirah
- Wikipedia: English Qaballa. https://en.wikipedia.org/wiki/English_Qaballa
- Mathers, S. L. MacGregor. *The Kabbalah Unveiled* (1887), Introduction — ark-db library, p. 13.
- Ginsburg, C. D. *The Kabbalah: Its Doctrines, Development, and Literature* (1865).
- Agrippa, H. C. *De Occulta Philosophia* (1533), Book II, ch. xx.
- Crowley, A. & Bennett, A. *Sepher Sephiroth sub figurâ D*, supplement to *The Equinox* I(8)
  (1912).
- Diaconis, P. & Mosteller, F. "Methods for Studying Coincidences." *Journal of the American
  Statistical Association* 84, 853–861 (1989). https://doi.org/10.1080/01621459.1989.10478847
- Levin, B. "A Representation for Multinomial Cumulative Distribution Functions." *Annals of
  Statistics* 9 (1981). https://doi.org/10.1214/aos/1176345593
- Abramson, M. & Moser, W. O. J. "More Birthday Surprises." *American Mathematical Monthly* 77,
  856–858 (1970). https://doi.org/10.1080/00029890.1970.11992600
- Haigh, J. *Taking Chances: Winning with Probability.* Oxford University Press (1999).
- Fisher, R. A. "A Method of Scoring Coincidences in Tests with Playing Cards." *Proceedings of
  the Society for Psychical Research* 34, 181–185 (1924).
- Kammerer, P. *Das Gesetz der Serie* (1919).
- Witztum, D., Rips, E. & Rosenberg, Y. "Equidistant Letter Sequences in the Book of Genesis."
  *Statistical Science* 9 (1994). https://doi.org/10.1214/ss/1177010393
- McKay, B., Bar-Natan, D., Bar-Hillel, M. & Kalai, G. "Solving the Bible Code Puzzle."
  *Statistical Science* 14 (1999). https://doi.org/10.1214/ss/1009212243

**Scoring forced-choice and free-response designs**

- Rhine, J. B. & Pratt, J. G. *Parapsychology: Frontier Science of the Mind.* Thomas (1957).
- Greville, T. N. E. "The Frequency Distribution of a General Matching Problem." *Annals of
  Mathematical Statistics* 12, 350–354 (1941). https://doi.org/10.1214/aoms/1177731718
- Read, R. C. "Card-Guessing with Information — A Problem in Probability." *American Mathematical
  Monthly* 69, 506–511 (1962). https://doi.org/10.1080/00029890.1962.11989919
- Diaconis, P. & Graham, R. "The Analysis of Sequential Experiments with Feedback to Subjects."
  *Annals of Statistics* 9 (1981). https://doi.org/10.1214/aos/1176345329
- Bem, D. J. & Honorton, C. "Does psi exist? Replicable evidence for an anomalous process of
  information transfer." *Psychological Bulletin* 115, 4–18 (1994).
  https://doi.org/10.1037/0033-2909.115.1.4
- Storm, L., Tressoldi, P. E. & Di Risio, L. "Meta-analysis of free-response studies, 1992–2008."
  *Psychological Bulletin* 136, 471–485 (2010). https://doi.org/10.1037/a0019457
- Utts, J. "Replication and Meta-Analysis in Parapsychology." *Statistical Science* 6 (1991).
  https://doi.org/10.1214/ss/1177011577
- Solfvin, G. F., Kelly, E. F. & Burdick, D. S. "Some new methods of analysis for
  preferential-ranking data." *Journal of the American Society for Psychical Research* 72, 93–110
  (1978).
- May, E. C., Utts, J. M., Humphrey, B. S., Luke, W. L. W., Frivold, T. J. & Trask, V. V. "Advances
  in remote-viewing analysis." *Journal of Parapsychology* 54, 193–228 (1990).
- Marks, D. & Kammann, R. "Information transmission in remote viewing experiments." *Nature* 274,
  680–681 (1978). https://doi.org/10.1038/274680a0
- Markwick, B. "The Soal–Goldney experiments with Basil Shackleton: new evidence of data
  manipulation." *Proceedings of the Society for Psychical Research* 56 (1978).
- Šidák, Z. "Rectangular confidence regions for the means of multivariate normal distributions."
  *Journal of the American Statistical Association* 62, 626–633 (1967).
- Bailey, D. H. & López de Prado, M. "The Deflated Sharpe Ratio." *Journal of Portfolio
  Management* 40(5) (2014).

**Time, sky and environmental correlates**

- Meeus, J. *Astronomical Algorithms*, 2nd ed. Willmann-Bell (1998).
- U.S. Naval Observatory. "Computing Greenwich Apparent Sidereal Time."
  https://aa.usno.navy.mil/faq/GAST
- Spottiswoode, S. J. P. "Apparent association between effect size in free response anomalous
  cognition experiments and local sidereal time." *Journal of Scientific Exploration* 11(2) (1997).
- McMoneagle, J. *Remote Viewing Secrets* (2000), Appendices B and C (reprints of Spottiswoode 1997
  and the 1998 geomagnetic follow-up).
- Sturrock, P. A. & Spottiswoode, S. J. P. "Time-series power spectrum analysis of performance in
  free response anomalous cognition experiments." *Journal of Scientific Exploration* 21, 47–66
  (2007).
- Ryan, A. "New insights into the links between ESP and geomagnetic activity." *Journal of
  Scientific Exploration* 22(3), 335–358 (2008).
- Ryan, A. & Spottiswoode, S. J. P. "Variation of ESP by season, local sidereal time and
  geomagnetic activity." In May, E. & Marwaha, S. (eds.) *Extrasensory Perception: Support,
  Skepticism and Science*, vol. 1, Praeger (2015); summarised in the SPR Psi Encyclopedia, "Adrian
  Ryan". https://psi-encyclopedia.spr.ac.uk/articles/adrian-ryan

**Ledgers, registrations and tamper evidence**

- Rundgren, A., Jordan, B. & Erdtman, S. *JSON Canonicalization Scheme (JCS).* RFC 8785 (2020).
  https://www.rfc-editor.org/rfc/rfc8785
- Laurie, B., Langley, A. & Kasper, E. *Certificate Transparency.* RFC 6962 (2013).
  https://www.rfc-editor.org/rfc/rfc6962
- Laurie, B., Messeri, E. & Stradling, R. *Certificate Transparency Version 2.0.* RFC 9162 (2021).
  https://www.rfc-editor.org/rfc/rfc9162
- C2SP. "signed-note." https://c2sp.org/signed-note
- Schneier, B. & Kelsey, J. "Secure Audit Logs to Support Computer Forensics." *ACM Transactions
  on Information and System Security* 2, 159–176 (1999). https://doi.org/10.1145/317087.317089
- Crosby, S. A. & Wallach, D. S. "Efficient Data Structures for Tamper-Evident Logging." *USENIX
  Security Symposium* (2009). https://www.usenix.org/legacy/event/sec09/tech/full_papers/crosby.pdf
- Blum, M. "Coin Flipping by Telephone: A Protocol for Solving Impossible Problems." *ACM SIGACT
  News* 15, 23–27 (1983). https://doi.org/10.1145/1008908.1008911
- Kekecs, Z. et al. "Raising the value of research studies in psychological science by increasing
  the credibility of research reports: the Transparent Psi Project." *Royal Society Open Science*
  10, 191375 (2023). https://doi.org/10.1098/rsos.191375 — Correction: *Royal Society Open Science*
  10, 231080 (2023). https://doi.org/10.1098/rsos.231080
- Koestler Parapsychology Unit — study registry. https://koestlerunit.wordpress.com/study-registry/
- Sigstore — Rekor transparency log. https://docs.sigstore.dev/logging/overview/
