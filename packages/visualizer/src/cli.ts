#!/usr/bin/env bun
/**
 * `mindpeeker-viz` — demo dashboard wiring a live entropy source to every
 * panel. A thin entry over `demo.ts` (where the parsing, stream plumbing and
 * statistics live and are unit-tested): parse `Bun.argv`, start the demo,
 * print the URL and every channel failure, stop cleanly on Ctrl+C.
 *
 * Prints the URL; never auto-opens a browser. Bun-only.
 */
import {
  CHANNEL_LABELS,
  createErrorReporter,
  type DemoSession,
  parseArgs,
  sourceListing,
  startDemo,
  USAGE,
} from './demo.js'
import { describeError } from './internal/describe-error.js'

function exitWith(code: number, message: string): never {
  if (code === 0) console.log(message)
  else console.error(message)
  process.exit(code)
}

let parsed: ReturnType<typeof parseArgs>
try {
  parsed = parseArgs(Bun.argv.slice(2))
} catch (error) {
  exitWith(1, `${describeError(error)}\n\n${USAGE}`)
}
if (parsed.command === 'help') exitWith(0, USAGE)
if (parsed.command === 'list-sources') exitWith(0, sourceListing())

let session: DemoSession
try {
  session = startDemo(parsed.options, {
    onChannelError: createErrorReporter((line) => console.error(line)),
  })
} catch (error) {
  exitWith(1, describeError(error))
}

console.log(`mindpeeker visualizer demo → ${session.dashboard.url}`)
console.log(`source: ${session.providerName} — ${session.note}`)
console.log(
  `channels: ${session.providerName} noise · ${CHANNEL_LABELS.negentropy} · ${CHANNEL_LABELS.cumdev} · ${CHANNEL_LABELS.histogram} · ${CHANNEL_LABELS.rateCard}`,
)
console.log('channel failures are printed here; press Ctrl+C to stop')

process.once('SIGINT', () => {
  // stop() aborts every stream and awaits the dashboard drain (1000 closes).
  void session.stop().then(() => process.exit(0))
})
