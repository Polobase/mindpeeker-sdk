<script setup lang="ts">
/**
 * §7 — the fixture-validated numerical core behind every p-value on this page,
 * as a set of calculators. `@mindpeeker/negentropy/numerics` is a secondary
 * entry point with the same semver guarantees as the root export.
 */
import {
  betaInc,
  betaPpf,
  binomialCdf,
  binomialPmf,
  binomialSf,
  chi2Cdf,
  chi2Isf,
  chi2Ppf,
  chi2Sf,
  gammaP,
  gammaQ,
  KahanSum,
  lnBeta,
  lnGamma,
  normCdf,
  normPpf,
  normSf,
  Welford,
} from '@mindpeeker/negentropy/numerics'
import { errorLine } from '~/lib/errors'
import { fmtNum } from '~/lib/format'

/** A field that accepts scientific notation ("5.184e6") and reports its own error. */
function numberField(initial: number) {
  const text = ref(String(initial))
  const value = computed(() => Number(text.value))
  const valid = computed(() => text.value.trim() !== '' && Number.isFinite(value.value))
  return { text, value, valid }
}

const chiX = numberField(5200000)
const chiDf = numberField(5184000)
const chiP = numberField(0.05)

const chiSquare = computed(() => {
  try {
    if (!chiX.valid.value || !chiDf.valid.value || !chiP.valid.value) return null
    return {
      sf: chi2Sf(chiX.value.value, chiDf.value.value),
      cdf: chi2Cdf(chiX.value.value, chiDf.value.value),
      ppf: chi2Ppf(chiP.value.value, chiDf.value.value),
      isf: chi2Isf(chiP.value.value, chiDf.value.value),
      envelope: chi2Isf(chiP.value.value, chiDf.value.value) - chiDf.value.value,
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { sf: 0, cdf: 0, ppf: 0, isf: 0, envelope: 0, error: errorLine(error) }
  }
})

const normZ = numberField(1.96)
const normP = numberField(0.975)
const normal = computed(() => {
  try {
    if (!normZ.valid.value || !normP.valid.value) return null
    return {
      cdf: normCdf(normZ.value.value),
      sf: normSf(normZ.value.value),
      ppf: normPpf(normP.value.value),
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { cdf: 0, sf: 0, ppf: 0, error: errorLine(error) }
  }
})

const gammaA = numberField(2592000)
const gammaX = numberField(2600000)
const gamma = computed(() => {
  try {
    if (!gammaA.valid.value || !gammaX.valid.value) return null
    return {
      p: gammaP(gammaA.value.value, gammaX.value.value),
      q: gammaQ(gammaA.value.value, gammaX.value.value),
      lnG: lnGamma(gammaA.value.value),
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { p: 0, q: 0, lnG: 0, error: errorLine(error) }
  }
})

const betaA = numberField(3)
const betaB = numberField(7)
const betaX = numberField(0.35)
const betaQ = numberField(0.95)
const beta = computed(() => {
  try {
    if (!betaA.valid.value || !betaB.valid.value || !betaX.valid.value || !betaQ.valid.value) {
      return null
    }
    return {
      inc: betaInc(betaA.value.value, betaB.value.value, betaX.value.value),
      ppf: betaPpf(betaQ.value.value, betaA.value.value, betaB.value.value),
      lnB: lnBeta(betaA.value.value, betaB.value.value),
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { inc: 0, ppf: 0, lnB: 0, error: errorLine(error) }
  }
})

const binK = numberField(100)
const binN = numberField(200)
const binP = numberField(0.5)
const binomial = computed(() => {
  try {
    if (!binK.valid.value || !binN.valid.value || !binP.valid.value) return null
    return {
      pmf: binomialPmf(binK.value.value, binN.value.value, binP.value.value),
      cdf: binomialCdf(binK.value.value, binN.value.value, binP.value.value),
      sf: binomialSf(binK.value.value, binN.value.value, binP.value.value),
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { pmf: 0, cdf: 0, sf: 0, error: errorLine(error) }
  }
})

/** The documented compensated-summation example: 1e16 + 1 − 1e16. */
const kahan = (() => {
  const sum = new KahanSum()
  sum.add(1e16)
  sum.add(1)
  sum.add(-1e16)
  const naive = 1e16 + 1 - 1e16
  const welford = new Welford()
  for (const value of [2, 4, 4, 4, 5, 5, 7, 9]) welford.push(value)
  return { compensated: sum.value, naive, welford }
})()

function applyGcpScale(): void {
  chiDf.text.value = '5184000'
  chiX.text.value = '5200000'
  chiP.text.value = '0.05'
}
function applyTinyTail(): void {
  chiDf.text.value = '1'
  chiX.text.value = '30'
  chiP.text.value = '1e-12'
}

const snippet = `import {
  chi2Isf, chi2Sf, binomialSf, normPpf, gammaQ,
} from '@mindpeeker/negentropy/numerics'

// 60 sources at 1 Hz for a day: devvar has 5 184 000 degrees of freedom
chi2Sf(5_200_000, 5_184_000)      // exact, O(1) — Temme's uniform expansion
chi2Isf(0.05, 5_184_000)          // the significanceEnvelope quantile at that t
chi2Ppf(1e-12, 1)                 // 1.5708e-24 — relative accuracy in the lower tail
binomialSf(120, 200, 0.5)         // P(X > 120) for a 200-bit trial, exact
normPpf(0.975)                    // 1.959963985 (Wichura AS 241)`
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="numerics"
      title="χ², normal and the incomplete gamma"
      description="The tails every statistic on this page reads. Invalid arguments throw NegentropyError('invalid_config'), a failed iteration throws 'numerical', and infinite arguments return exact limits — nothing silently returns NaN."
      :api="['chi2Sf', 'chi2Cdf', 'chi2Ppf', 'chi2Isf', 'normCdf', 'normSf', 'normPpf', 'gammaP', 'gammaQ', 'lnGamma']"
    >
      <template #controls>
        <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-network" @click="applyGcpScale">
          GCP scale: df = 5 184 000
        </UButton>
        <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-microscope" @click="applyTinyTail">
          Tiny tail: p = 1e-12, df = 1
        </UButton>
      </template>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-default p-3 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-highlighted">Chi-square</h3>
          <div class="grid grid-cols-3 gap-2">
            <UFormField label="x" size="xs">
              <UInput v-model="chiX.text.value" size="xs" class="w-full" aria-label="chi-square x" />
            </UFormField>
            <UFormField label="df (k)" size="xs">
              <UInput v-model="chiDf.text.value" size="xs" class="w-full" aria-label="degrees of freedom" />
            </UFormField>
            <UFormField label="p / q" size="xs">
              <UInput v-model="chiP.text.value" size="xs" class="w-full" aria-label="probability" />
            </UFormField>
          </div>
          <p v-if="chiSquare?.error" class="text-xs text-error">{{ chiSquare.error }}</p>
          <dl v-else-if="chiSquare" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono tabular-nums">
            <dt class="text-muted">chi2Sf(x, k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(chiSquare.sf, { digits: 6 }) }}</dd>
            <dt class="text-muted">chi2Cdf(x, k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(chiSquare.cdf, { digits: 6 }) }}</dd>
            <dt class="text-muted">chi2Ppf(p, k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(chiSquare.ppf, { digits: 4 }) }}</dd>
            <dt class="text-muted">chi2Isf(q, k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(chiSquare.isf, { digits: 4 }) }}</dd>
            <dt class="text-muted">isf − k (the envelope)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(chiSquare.envelope, { digits: 4 }) }}</dd>
          </dl>
          <p class="text-xs text-muted">
            <code class="text-primary">chi2Isf</code> keeps relative precision for q below 2⁻⁵³,
            where <code class="text-primary">chi2Ppf(1 − q, k)</code> would round to 1. In 0.1.x
            <code class="text-primary">chi2Sf</code> threw from df ≈ 3.7·10⁶ near the mean — the GCP
            scale above is exactly the case that crashed.
          </p>
        </div>

        <div class="rounded-md border border-default p-3 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-highlighted">Normal &amp; gamma</h3>
          <div class="grid grid-cols-2 gap-2">
            <UFormField label="z" size="xs">
              <UInput v-model="normZ.text.value" size="xs" class="w-full" aria-label="normal z" />
            </UFormField>
            <UFormField label="p (for the quantile)" size="xs">
              <UInput v-model="normP.text.value" size="xs" class="w-full" aria-label="normal probability" />
            </UFormField>
          </div>
          <p v-if="normal?.error" class="text-xs text-error">{{ normal.error }}</p>
          <dl v-else-if="normal" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono tabular-nums">
            <dt class="text-muted">normCdf(z)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(normal.cdf, { digits: 8 }) }}</dd>
            <dt class="text-muted">normSf(z)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(normal.sf, { digits: 8 }) }}</dd>
            <dt class="text-muted">normPpf(p)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(normal.ppf, { digits: 8 }) }}</dd>
          </dl>
          <div class="grid grid-cols-2 gap-2">
            <UFormField label="a" size="xs">
              <UInput v-model="gammaA.text.value" size="xs" class="w-full" aria-label="gamma a" />
            </UFormField>
            <UFormField label="x" size="xs">
              <UInput v-model="gammaX.text.value" size="xs" class="w-full" aria-label="gamma x" />
            </UFormField>
          </div>
          <p v-if="gamma?.error" class="text-xs text-error">{{ gamma.error }}</p>
          <dl v-else-if="gamma" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono tabular-nums">
            <dt class="text-muted">gammaP(a, x)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(gamma.p, { digits: 8 }) }}</dd>
            <dt class="text-muted">gammaQ(a, x)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(gamma.q, { digits: 8 }) }}</dd>
            <dt class="text-muted">lnGamma(a)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(gamma.lnG, { digits: 6 }) }}</dd>
          </dl>
          <p class="text-xs text-muted">
            For a ≥ 100 with |x − a| &lt; 0.3a the incomplete gammas switch to Temme's uniform
            asymptotic expansion: O(1) in a, ~1e-13 relative up to a = 5·10⁸.
          </p>
        </div>
      </div>

      <template #footer>
        Reference values come from 40-digit mpmath, scipy grids and exact BigInt enumeration —
        checked into the package as fixtures, so <code>bun test</code> needs no Python.
      </template>
    </DemoSection>

    <DemoSection
      id="beta-binomial"
      title="Beta, binomial and compensated sums"
      description="The incomplete beta behind every binomial tail, and the accumulators that keep long sums honest."
      :api="['betaInc', 'betaPpf', 'lnBeta', 'binomialPmf', 'binomialCdf', 'binomialSf', 'KahanSum', 'Welford']"
    >
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-default p-3 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-highlighted">Incomplete beta</h3>
          <div class="grid grid-cols-4 gap-2">
            <UFormField label="a" size="xs">
              <UInput v-model="betaA.text.value" size="xs" class="w-full" aria-label="beta a" />
            </UFormField>
            <UFormField label="b" size="xs">
              <UInput v-model="betaB.text.value" size="xs" class="w-full" aria-label="beta b" />
            </UFormField>
            <UFormField label="x" size="xs">
              <UInput v-model="betaX.text.value" size="xs" class="w-full" aria-label="beta x" />
            </UFormField>
            <UFormField label="q" size="xs">
              <UInput v-model="betaQ.text.value" size="xs" class="w-full" aria-label="beta quantile" />
            </UFormField>
          </div>
          <p v-if="beta?.error" class="text-xs text-error">{{ beta.error }}</p>
          <dl v-else-if="beta" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono tabular-nums">
            <dt class="text-muted">betaInc(a, b, x)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(beta.inc, { digits: 8 }) }}</dd>
            <dt class="text-muted">betaPpf(q, a, b)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(beta.ppf, { digits: 8 }) }}</dd>
            <dt class="text-muted">lnBeta(a, b)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(beta.lnB, { digits: 6 }) }}</dd>
          </dl>
        </div>

        <div class="rounded-md border border-default p-3 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-highlighted">Binomial (a 200-bit trial)</h3>
          <div class="grid grid-cols-3 gap-2">
            <UFormField label="k" size="xs">
              <UInput v-model="binK.text.value" size="xs" class="w-full" aria-label="binomial k" />
            </UFormField>
            <UFormField label="n" size="xs">
              <UInput v-model="binN.text.value" size="xs" class="w-full" aria-label="binomial n" />
            </UFormField>
            <UFormField label="p" size="xs">
              <UInput v-model="binP.text.value" size="xs" class="w-full" aria-label="binomial p" />
            </UFormField>
          </div>
          <p v-if="binomial?.error" class="text-xs text-error">{{ binomial.error }}</p>
          <dl v-else-if="binomial" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono tabular-nums">
            <dt class="text-muted">binomialPmf(k, n, p)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(binomial.pmf, { digits: 8 }) }}</dd>
            <dt class="text-muted">binomialCdf(k, n, p) — P(X ≤ k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(binomial.cdf, { digits: 8 }) }}</dd>
            <dt class="text-muted">binomialSf(k, n, p) — P(X &gt; k)</dt>
            <dd class="text-right text-highlighted">{{ fmtNum(binomial.sf, { digits: 8 }) }}</dd>
          </dl>
          <p class="text-xs text-muted">
            k = 100, n = 200, p = ½ is exactly one GCP trial at its null mean: the pmf is 0.0563 and
            the two tails sum to 1 + pmf. n ≫ 10⁶ is fine — the tails go through the incomplete beta,
            never a loop.
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="KahanSum: 1e16 + 1 − 1e16"
          :value="kahan.compensated"
          :digits="0"
          note="Neumaier's variant — correct even when a term exceeds the running sum"
        />
        <StatTile
          label="Naive float sum"
          :value="kahan.naive"
          :digits="0"
          tone="warning"
          note="the 1 is lost to rounding before the subtraction"
        />
        <StatTile
          label="Welford variance"
          :value="kahan.welford.variance"
          :digits="4"
          :note="`n = ${kahan.welford.n}, mean ${fmtNum(kahan.welford.mean, { digits: 3 })}, sd ${fmtNum(kahan.welford.sd, { digits: 4 })}`"
        />
      </div>

      <CodeSnippet :code="snippet" title="the numerics entry point" />

      <template #footer>
        <HonestNote variant="exact">
          Nothing on this tab is a statistic — these are the exact special functions the statistics
          are built from, deterministic and browser-safe, with no I/O and no <code>node:</code>
          builtins. Same inputs, same outputs, every time.
        </HonestNote>
      </template>
    </DemoSection>
  </div>
</template>
