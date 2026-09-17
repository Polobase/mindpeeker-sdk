/**
 * Recipe 2: a pre-registered tripolar run with a yoked control arm, a hash-chained
 * recording and a beacon + VDF time bracket.
 * bun examples/src/02-preregistered-tripolar.ts [--source crypto] [--control offline] [--live] [--smoke]
 */
import { DRAND_CHAINS } from '@mindpeeker/entropy/providers'
import {
  verifyChain as ledgerVerifyChain,
  type Registration,
  registrationHash,
  type TimeBracket,
  timeBracketHash,
  timeBracketSealInput,
  toHex,
  validateTimeBracket,
  verifyTimeBracket,
} from '@mindpeeker/ledger'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import {
  analyzeTripolar,
  controlContrast,
  readSession,
  recordSession,
  registerTripolar,
  type TrialSeries,
  type TripolarRun,
  tostEquivalence,
  tripolarBayesFactor,
  tripolarSchedule,
  verifyChain,
} from '@mindpeeker/psi'
import { sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'
import { drandBeacon } from './lib/drand-fixture.js'

const args = parseArgs()
const experimental = openSource(args.source, 'experimental')
const control = openSource(args.control, 'control') // a source the operator cannot influence

// 1. Freeze the protocol. The schedule seed stays with the experimenter until the end.
const tripolar = await registerTripolar({
  runsPerIntention: size(args, 10, 2),
  trialsPerRun: size(args, 50, 10),
  order: 'instructed',
  seed: '9b1c62d4',
})
const { runsPerIntention, trialsPerRun } = tripolar.plan
const eps0 = 0.02 // control-arm equivalence margin per bit, fixed now
const perBitEffectSd = 1e-4 // Bayes-factor prior scale: PEAR-sized effects
const registration: Registration = {
  title: 'Cookbook: tripolar REG run with a yoked control arm',
  hypotheses: [
    {
      id: 'H1',
      statement: 'high-intention runs exceed low-intention runs',
      kind: 'confirmatory',
      statistic: 'deltaZ from psi analyzeTripolar',
      null: 'N(0, 1)',
      direction: 'greater',
    },
    {
      id: 'C1',
      statement: `the control arm's deltaEffect lies within ±${eps0} per bit (TOST)`,
      kind: 'exploratory',
    },
  ],
  primary: 'H1',
  alpha: 0.05,
  sample: { kind: 'fixed', size: 3 * runsPerIntention * trialsPerRun, unit: 'trials per arm' },
  analysisPlanHash: tripolar.hash,
  exclusions: [],
  dataSources: [
    { name: experimental.name, role: 'experimental' },
    { name: control.name, role: 'control' },
  ],
  notes: `Bayes factor prior sd ${perBitEffectSd} per bit; schedule ${tripolar.scheduleDigest}`,
}
const regHash = await registrationHash(registration) // publish this before collecting

// 2. Bracket: bind the registration to a beacon round published after it, then seal.
const beacon = drandBeacon(args.live)
const { bytes: pulse, sources } = await beacon.getBytes(32)
const round = sources[0]?.rounds?.[0]
if (round?.timestamp === undefined) throw new Error('beacon round without a timestamp')
const bracket = validateTimeBracket({
  registrationHash: regHash,
  notBefore: {
    beacon: {
      source: 'drand',
      chain: DRAND_CHAINS.quicknet.hash,
      round: round.round,
      timestamp: new Date(round.timestamp).toISOString(),
      valueHex: toHex(pulse),
    },
  },
})
const sealInput = timeBracketSealInput(bracket)
const seal = await sealBeacon(sealInput, size(args, 100_000, 1_000)) // a demo T, not a real delay
const sealed: TimeBracket = {
  ...bracket,
  seal: { kind: 'vdf-pietrzak', bytesHex: toHex(sealToBytes(seal, sealInput)) },
}
const genesis = await timeBracketHash(sealed) // the recording starts from the sealed bracket

// 3. Collect both arms in lock-step, every trial line hash-chained to the previous one.
const schedule = tripolarSchedule(tripolar.plan)
const rounds = 3 * runsPerIntention * trialsPerRun
const lines: string[] = []
const start = Date.parse(sealed.notBefore.beacon.timestamp)
const offline = args.source === 'offline' && args.control === 'offline'
for await (const line of recordSession([experimental, control], {
  chain: { registration: genesis },
  tags: (r, source) => ({
    arm: source === control.name ? 'control' : 'experimental',
    run: Math.floor(r / trialsPerRun),
    segment: schedule[Math.floor(r / trialsPerRun)] as string,
  }),
  now: offline ? () => start + lines.length : Date.now, // reproducible offline head
})) {
  lines.push(line)
  if (lines.length === 1 + 2 * rounds) break
}

// 4. Anyone holding the lines, the head and the bracket can check all of it offline.
const psiCheck = await verifyChain(lines, { registration: genesis })
const ledgerCheck = await ledgerVerifyChain(lines, { format: 'psi', genesis, head: psiCheck.head })
const tampered = [...lines]
const edited = JSON.parse(tampered[7] as string) as { sum: number }
edited.sum = edited.sum === 0 ? 1 : edited.sum - 1
tampered[7] = JSON.stringify(edited)
const tamperCheck = await ledgerVerifyChain(tampered, { format: 'psi', genesis })
const replay = await beacon.getRound(round.round) // fetch the round yourself
const bracketCheck = await verifyTimeBracket(sealed, {
  registrationHash: regHash,
  beacon: { valueHex: toHex(replay.bytes) },
  verifySeal: verifySealBytes,
  requireSeal: true,
})

// 5. Analyze the verified recording against the registered plan.
const series = await readSession(lines)
function runsOf(name: string, arm: 'experimental' | 'control'): TripolarRun[] {
  const s = series.find((x) => x.source === name) as TrialSeries
  return schedule.map((intention, sequence) => ({
    intention,
    run: schedule.slice(0, sequence).filter((i) => i === intention).length,
    sequence,
    arm,
    assignment: 'instructed',
    order: tripolar.plan.order,
    xorSafeguard: tripolar.plan.xorSafeguard,
    scheduleDigest: tripolar.scheduleDigest,
    series: {
      source: s.source,
      bitsPerTrial: s.bitsPerTrial,
      sums: s.sums.slice(sequence * trialsPerRun, (sequence + 1) * trialsPerRun),
    },
  }))
}
const exp = analyzeTripolar(runsOf(experimental.name, 'experimental'), { registration: tripolar })
const ctl = analyzeTripolar(runsOf(control.name, 'control'), { registration: tripolar })
const contrast = controlContrast(exp, ctl)
const tost = tostEquivalence(ctl, { eps0 })
const bayes = tripolarBayesFactor(exp, { perBitEffectSd })
const bitsForEps = (e: number) => Math.ceil(2 * (normPpf(0.95) / e) ** 2) // per intention

console.log('tripolar plan hash ', tripolar.hash)
console.log('registration hash  ', regHash)
console.log('beacon round       ', round.round, sealed.notBefore.beacon.timestamp)
console.log(
  'bracket            ',
  bracketCheck.ok,
  `beacon ${bracketCheck.beacon}`,
  `seal ${bracketCheck.seal}`,
)
console.log('chain head         ', psiCheck.head, `(${psiCheck.lines} lines)`)
console.log('psi / ledger verify', psiCheck.ok, ledgerCheck.ok, ledgerCheck.head === psiCheck.head)
console.log(
  'one edited sum     ',
  tamperCheck.ok,
  tamperCheck.failure,
  `at line ${tamperCheck.brokenAt}`,
)
console.log('deltaZ (H1)        ', fmt(exp.deltaZ), `p ${fmt(exp.deltaP)}`)
console.log('deltaEffect 95% CI ', exp.deltaCi95.map((x) => fmt(x, 5)).join(' … '))
console.log('baseline bind z    ', fmt(exp.baseline?.variance.z ?? Number.NaN))
console.log('control contrast z ', fmt(contrast.z), `p ${fmt(contrast.pValue)}`)
console.log(
  'control TOST       ',
  `equivalent ${tost.equivalent}`,
  `p ${fmt(tost.pValue)}`,
  `eps0 ${eps0}`,
)
console.log('BF10 (sd 1e-4/bit) ', fmt(bayes.bf10))
console.log(
  'bits/intention     ',
  `${exp.high.bits} used; ${bitsForEps(1e-4)} for a TOST at eps0 1e-4`,
)
