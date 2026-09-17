#!/usr/bin/env bun
/**
 * `mindpeeker-viz` — demo dashboard wiring a live entropy source (or a
 * verified `--replay` recording) to the panels. A thin entry over `demo.ts`
 * (where the parsing, stream plumbing, statistics and recording live and are
 * unit-tested): parse `Bun.argv`, start the demo, print the URL, every channel
 * failure and health event, stop cleanly on Ctrl+C.
 *
 * Prints the URL; never auto-opens a browser. Bun-only.
 */
import {
  CHANNEL_LABELS,
  createErrorReporter,
  type DemoSession,
  type HealthEvent,
  parseArgs,
  sourceListing,
  startDemo,
  startReplay,
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
  exitWith(1, `${describeError(error, 1000)}\n\n${USAGE}`)
}
if (parsed.command === 'help') exitWith(0, USAGE)
if (parsed.command === 'list-sources') exitWith(0, sourceListing())

const runtime = {
  onChannelError: createErrorReporter((line) => console.error(line)),
  onHealthEvent: (event: HealthEvent) =>
    console.error(
      `${event.source}: health_test failure ${event.failures} (${event.restarted ? 'session restarted' : 'giving up'}): ${event.error.message}`,
    ),
}

let session: DemoSession
try {
  session =
    parsed.command === 'replay'
      ? await startReplay(parsed.options, runtime)
      : await startDemo(parsed.options, runtime)
} catch (error) {
  exitWith(1, describeError(error, 1000))
}

const channels =
  parsed.command === 'replay'
    ? [CHANNEL_LABELS.cumdev, CHANNEL_LABELS.netvar]
    : [
        `${session.providerName} noise`,
        CHANNEL_LABELS.negentropy,
        CHANNEL_LABELS.cumdev,
        CHANNEL_LABELS.netvar,
        CHANNEL_LABELS.histogram,
        CHANNEL_LABELS.rateCard,
      ]
console.log(`mindpeeker visualizer demo → ${session.dashboard.url}`)
console.log(
  `${parsed.command === 'replay' ? 'replaying' : 'source'}: ${session.providerName === 'replay' ? session.note : `${session.providerName} — ${session.note}`}`,
)
if (parsed.command === 'run' && parsed.options.record !== undefined) {
  console.log(`recording trials → ${parsed.options.record}`)
}
console.log(`channels: ${channels.join(' · ')}`)
console.log('channel failures are printed here; press Ctrl+C to stop')

process.once('SIGINT', () => {
  // stop() aborts every stream, awaits the dashboard drain (1000 closes) and closes a recording.
  void session.stop().then(() => process.exit(0))
})
