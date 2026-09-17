/**
 * Recipe 4: oracle casts with exact accounting and a byte-exact recorded replay.
 * bun examples/src/04-oracle-replay.ts [--source crypto] [--smoke]
 */
import {
  byteReader,
  castHexagram,
  castShield,
  type HexagramCast,
  houses,
  LINE_WEIGHTS,
  partOfFortune,
  reconciler,
  recordingReader,
  type ShieldCast,
} from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const source = openSource(args.source, 'oracle')

// 1. One session on one recorded stream: yarrow odds, one moving line, a geomantic chart.
const rec = recordingReader(source)
const yarrow = await castHexagram(rec.reader, { method: 'yarrow' })
const single = await castHexagram(rec.reader, { method: 'singleLine' })
const shield = await castShield(rec.reader)
await rec.reader.close() // releases the provider's stream
const recorded = rec.bytes()

const hexagram = (c: HexagramCast) =>
  `#${c.primary.kingWen} ${c.primary.name.en}; moving [${c.changing}]` +
  (c.relating ? ` → #${c.relating.kingWen}` : '')
const receipt = (c: HexagramCast | ShieldCast) =>
  `${c.bytesConsumed} bytes consumed, ${c.bytesFetched} fetched, ${c.bitsUsed} bits used`
const fortune = partOfFortune(shield)
console.log('yarrow             ', hexagram(yarrow), `(${receipt(yarrow)})`)
console.log('single moving line ', hexagram(single), `(${receipt(single)})`)
console.log('shield judge       ', shield.judge.name, `(${receipt(shield)})`)
console.log('reconciler         ', reconciler(shield).name)
console.log(
  'part of fortune    ',
  `${fortune.total} points → figure ${fortune.index} ${fortune.figure.name}`,
)
console.log('ascendant (GD)     ', houses(shield, { system: 'goldenDawn' })[0]?.name)

// 2. Replay: the recorded bytes reproduce every reading, in order.
const replay = byteReader(recorded)
const again = [
  await castHexagram(replay, { method: 'yarrow' }),
  await castHexagram(replay, { method: 'singleLine' }),
  await castShield(replay),
] as const
const same =
  hexagram(again[0]) === hexagram(yarrow) &&
  hexagram(again[1]) === hexagram(single) &&
  again[2].mothers.map((m) => m.binary).join() === shield.mothers.map((m) => m.binary).join()
console.log(
  'recorded bytes     ',
  recorded.length,
  '= consumed',
  yarrow.bytesConsumed + single.bytesConsumed + shield.bytesConsumed,
)
console.log('replay identical   ', same)

// 3. The exact line odds against observed frequencies from the same source.
const casts = size(args, 2000, 50)
const counts = { yarrow: [0, 0, 0, 0], coins: [0, 0, 0, 0] }
const reader = byteReader(source)
for (let i = 0; i < casts; i++) {
  for (const method of ['yarrow', 'coins'] as const) {
    const cast = await castHexagram(reader, { method })
    for (const line of cast.lines) (counts[method][line.value - 6] as number)++
  }
}
await reader.close()
for (const method of ['yarrow', 'coins'] as const) {
  const total = LINE_WEIGHTS[method].reduce((a, b) => a + b, 0)
  const rows = LINE_WEIGHTS[method].map(
    (w, i) => `${6 + i}: ${w}/${total} vs ${fmt((counts[method][i] as number) / (6 * casts), 3)}`,
  )
  console.log(`${method} odds`.padEnd(19), rows.join('  '))
}

// 4. The derivation against its primary text: Liber XCVI's worked chart is the bytes CA 34.
const liber = await castShield(new Uint8Array([0xca, 0x34]))
console.log(
  'Liber XCVI chart   ',
  liber.judge.name,
  partOfFortune(liber).total,
  partOfFortune(liber).figure.name,
)
