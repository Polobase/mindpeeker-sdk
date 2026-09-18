<script setup lang="ts">
/**
 * The `mindpeeker-viz` CLI and the server's security posture — the half of the
 * package this page cannot run, because `createDashboard` is Bun-only.
 */
const SOURCES = [
  {
    flag: 'crypto',
    captures: 'software CSPRNG (crypto.getRandomValues)',
    needs: '—',
    health: false,
    note: 'the default',
  },
  { flag: 'jitter', captures: 'CPU clock jitter', needs: '—', health: true, note: '' },
  {
    flag: 'serial / esp32',
    captures: 'serial TRNG, e.g. an ESP32 running the AetherOnePi firmware',
    needs: 'a USB serial device',
    health: true,
    note: '--serial-path, --baud',
  },
  {
    flag: 'camera',
    captures: 'webcam sensor noise (frame-diff sign bits)',
    needs: 'ffmpeg, a camera',
    health: true,
    note: '--camera-device',
  },
  {
    flag: 'mic',
    captures: 'microphone thermal / ambient noise (sample LSBs)',
    needs: 'ffmpeg, a mic',
    health: true,
    note: '--mic-device',
  },
  {
    flag: 'hwrng',
    captures: 'kernel hardware RNG (/dev/hwrng)',
    needs: 'Linux / Pi, usually root',
    health: true,
    note: '--hwrng-path',
  },
]

const quickStart = `# published package
bunx mindpeeker-viz                      # → http://localhost:52814/
bunx mindpeeker-viz --list-sources       # the table below

# from a clone (the client bundle is built once)
bun run build
bun dist/cli.js --port 52814 --host localhost`

const sourceSnippet = `bunx mindpeeker-viz --source esp32                       # /dev/cu.usbserial-110 @ 921600
bunx mindpeeker-viz --source serial --serial-path /dev/ttyUSB0 --baud 115200
bunx mindpeeker-viz --source camera                      # webcam sensor noise via ffmpeg
bunx mindpeeker-viz --source mic --raw                   # microphone LSBs, unconditioned
bunx mindpeeker-viz --source jitter

# Invalid arguments exit 1 with a message, before anything binds:
#   --port outside 0–65535, a --baud that is not a positive integer,
#   an unknown flag or source, --replay combined with live flags.`

const securitySnippet = `import { createDashboard } from '@mindpeeker/visualizer'

const dash = createDashboard({
  host: 'localhost',                        // default; '0.0.0.0' exposes the stream
  allowedOrigins: ['https://lab.example'],  // needed behind a reverse proxy
  onChannelError: (channel, error) => log.warn(channel, error), // default: console.error
})

// A /ws handshake is accepted when it carries no Origin (non-browser tools),
// or when that origin's host equals the request's Host, or when it is listed
// above. Anything else — including the opaque origin "null" — gets HTTP 403.`
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      title="Run the real dashboard"
      :api="['createDashboard', 'Dashboard.url', 'attachByteStream', 'attachSeries', 'attachMatrix', 'attachStatic', 'setNote', 'stop']"
      description="The server is Bun-only — createDashboard uses Bun.serve and Bun.file, and
        package.json declares only engines.bun ≥ 1.2. The wire protocol and every line of client code
        are pure and browser-safe, which is why this page can run the panels without it."
    >
      <div class="grid gap-3 lg:grid-cols-2">
        <CodeSnippet :code="quickStart" lang="sh" title="quick start" />
        <CodeSnippet :code="sourceSnippet" lang="sh" title="choosing an entropy source" />
      </div>

      <div class="mt-4 overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Entropy sources the demo CLI accepts
          </caption>
          <thead class="text-muted text-xs uppercase bg-elevated/50">
            <tr>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">--source</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">what it captures</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">needs</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">flags</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">SP 800-90B</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in SOURCES" :key="row.flag" class="border-t border-default text-xs">
              <td class="py-1.5 px-3 font-mono text-primary whitespace-nowrap">{{ row.flag }}</td>
              <td class="py-1.5 px-3">{{ row.captures }}</td>
              <td class="py-1.5 px-3 text-muted whitespace-nowrap">{{ row.needs }}</td>
              <td class="py-1.5 px-3 font-mono text-dimmed whitespace-nowrap">
                {{ row.note || '—' }}
              </td>
              <td class="py-1.5 px-3">
                <UBadge
                  :color="row.health ? 'success' : 'neutral'"
                  variant="subtle"
                  class="whitespace-nowrap"
                >
                  {{ row.health ? 'health-tested' : 'not tested' }}
                </UBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div class="rounded-md border border-default p-3 text-sm text-muted">
          <h3 class="text-sm font-semibold text-highlighted mb-1">One device, opened once</h3>
          <p>
            A single device session is fanned out to every panel, so one camera or serial port is
            opened exactly once. If the device is absent the server stays up: every streaming panel
            shows an <code class="font-mono text-xs">error</code> badge with the reason and the
            terminal prints it once — later channels failing for the same reason print
            <code class="font-mono text-xs">(same reason)</code>.
          </p>
        </div>
        <div class="rounded-md border border-default p-3 text-sm text-muted">
          <h3 class="text-sm font-semibold text-highlighted mb-1">Health badges</h3>
          <p>
            Every physical-noise source runs entropy's SP 800-90B health tests. The noise panel's
            badge reads <code class="font-mono text-xs">SP 800-90B health tests: no failures</code>
            until a session ends with <code class="font-mono text-xs">EntropyError('health_test')</code>;
            the badge then shows the count and reason and the demo opens a fresh session. Three
            failing sessions in a row before any byte is final. The software CSPRNG is not
            health-tested and has no badge note.
          </p>
        </div>
      </div>

      <HonestNote variant="caveat" class="mt-4">
        <code class="font-mono text-xs">--raw</code> skips the SHA-256 conditioning and passes the
        hardware's health-tested raw samples. That is the right switch for inspecting a device, and
        the wrong one for anything downstream that assumes full-entropy bytes: raw sensor noise is
        biased and correlated by construction, and the bitmap will show it.
      </HonestNote>

      <template #footer>
        The demo plumbing lives in <code class="font-mono text-xs">src/demo.ts</code> with the
        argument parser, statistics monitor, recording and health modules under
        <code class="font-mono text-xs">src/demo/</code>; these are internal to the CLI, not package
        exports. <code class="font-mono text-xs">src/demo/monitor.ts</code> is pure, which is how this
        page reuses the CLI's exact statistics.
      </template>
    </DemoSection>

    <VisualizerReplay />

    <DemoSection
      title="Security: it streams raw entropy over a socket"
      :api="['createDashboard', 'DashboardOptions.allowedOrigins', 'VisualizerError']"
      description="The dashboard binds localhost by default and still guards the socket, because the
        frames carry raw entropy and live statistics. Four rules, all enforced at the handshake."
    >
      <div class="grid gap-3 lg:grid-cols-2">
        <!-- min-w-0 on both columns: the snippet opposite does not wrap, and an
             automatic minimum size would widen the shared column past the viewport. -->
        <div class="flex min-w-0 flex-col gap-3">
          <div class="rounded-md border border-default p-3">
            <h3 class="text-sm font-semibold text-highlighted">Origin check</h3>
            <p class="text-sm text-muted mt-1">
              A <code class="font-mono text-xs">/ws</code> handshake carrying an
              <code class="font-mono text-xs">Origin</code> header is accepted only when that origin's
              host equals the request's <code class="font-mono text-xs">Host</code> (same host and
              port) or is listed in <code class="font-mono text-xs">allowedOrigins</code>. Anything
              else — including the opaque origin <code class="font-mono text-xs">null</code> — gets
              HTTP 403. That is what stops a page on another site from reading your stream
              (cross-site WebSocket hijacking). Clients that send no Origin at all (curl, a script)
              are accepted.
            </p>
          </div>
          <div class="rounded-md border border-default p-3">
            <h3 class="text-sm font-semibold text-highlighted">DNS-rebinding guard</h3>
            <p class="text-sm text-muted mt-1">
              On a loopback bind (<code class="font-mono text-xs">localhost</code>,
              <code class="font-mono text-xs">127.0.0.0/8</code>,
              <code class="font-mono text-xs">::1</code>) the
              <code class="font-mono text-xs">Host</code> header must itself be a loopback name or the
              host of an <code class="font-mono text-xs">allowedOrigins</code> entry — so a name that
              resolves to 127.0.0.1 from someone else's DNS cannot reach the socket.
            </p>
          </div>
          <div class="rounded-md border border-default p-3">
            <h3 class="text-sm font-semibold text-highlighted">Send-only socket</h3>
            <p class="text-sm text-muted mt-1">
              Any inbound message closes the connection with 1003, and the runtime refuses inbound
              messages larger than 1 KiB (<code class="font-mono text-xs">maxPayloadLength</code>).
              The client never asks for anything; it only reads.
            </p>
          </div>
        </div>
        <div class="flex min-w-0 flex-col gap-3">
          <CodeSnippet :code="securitySnippet" title="hardening a deployment" />
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="No authentication, no TLS in the server itself"
            description="Binding a non-loopback host (--host 0.0.0.0) exposes the stream to the
              network. Put an authenticating proxy in front if that matters, and add its public
              origin to allowedOrigins — the client switches to wss: automatically when the page is
              served over https."
          />
        </div>
      </div>

      <HonestNote variant="fixed-in-0.2" class="mt-4">
        0.1 accepted any origin, ignored inbound messages up to 16 MiB, and let
        <code class="font-mono text-xs">Bun.serve</code> silently bind a different port for an invalid
        <code class="font-mono text-xs">port</code> option (70000 → 65535, −1 → ephemeral). 0.2.0
        validates <code class="font-mono text-xs">port</code>,
        <code class="font-mono text-xs">host</code>,
        <code class="font-mono text-xs">allowedOrigins</code> and
        <code class="font-mono text-xs">onChannelError</code> up front and throws
        <code class="font-mono text-xs">VisualizerError('server')</code> before anything binds.
      </HonestNote>

      <template #footer>
        Producer failures never take the server down: a channel whose source or encoder throws turns
        <code class="font-mono text-xs">status: 'error'</code> with the reason in the directory and is
        reported once through <code class="font-mono text-xs">onChannelError</code>.
        <code class="font-mono text-xs">stop()</code> pre-empts every pending pull, closes each
        iterator it consumes, sends a 1000 close to every socket and removes the listener it added —
        and every call returns the same in-flight promise.
      </template>
    </DemoSection>
  </div>
</template>
