<script setup lang="ts">
/** Section 3 — the physical sources that can run inside this tab. Each one is
 * optional, asks for a permission, and fails with a typed code when refused. */
import { LOCAL_SPECS } from '~/lib/entropy/local'
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="Physical noise, in your browser"
      :api="['cameraEntropy', 'micEntropy', 'sensorEntropy', 'serialEntropy', 'jitterEntropy']"
      description="Seven local providers share one pipeline: raw physical samples → SP 800-90B health tests (a start-up test, then continuous RCT and APT, always on) → SHA-256 extraction with a conservative entropy credit — or, with conditioning: 'raw', a health-tested passthrough of the unwhitened bits."
    >
      <HonestNote variant="caveat">
        Everything below is <strong>optional and asks your permission</strong>. Nothing starts on
        its own, nothing is uploaded — the samples never leave this tab, and no recording is kept:
        each session is opened for the bytes and closed again when you stop it or leave the tab.
        A refused prompt is not an error in your setup; it is
        <code class="font-mono">EntropyError('permission')</code>, shown exactly as the SDK reports
        it.
      </HonestNote>

      <div class="grid gap-4 xl:grid-cols-2 mt-4">
        <EntropyLocalCard v-for="spec in LOCAL_SPECS" :key="spec.id" :id="spec.id" />
      </div>

      <template #footer>
        A source that keeps failing its health tests throws
        <code class="font-mono">health_test</code> — it never silently degrades to pseudo-randomness.
        A source that produces <em>no</em> samples (a frozen scene, a silent radio) starves and ends
        in <code class="font-mono">timeout</code>. Two more local providers cannot run here at all:
        <code class="font-mono">sdrEntropy</code> needs an RTL-SDR dongle through
        <code class="font-mono">rtlSdrSource()</code> from <code class="font-mono">/node</code>, and
        <code class="font-mono">hwRng()</code> reads the kernel's
        <code class="font-mono">/dev/hwrng</code>.
      </template>
    </DemoSection>

    <DemoSection
      title="What the raw bytes actually measured"
      :level="3"
      description="Measurements from bun scripts/quality.ts over RAW output (Apple Silicon, 2026-07-07), next to the credit each provider claims. Statistical tests can only fail a source, never certify one — these numbers exist to catch a broken source and to show how much margin the credits carry."
    >
      <div class="overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm border-collapse">
          <caption class="sr-only">Measured raw entropy per local source against its credit</caption>
          <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="text-left font-medium px-3 py-2">Source</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Sample</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Shannon b/B</th>
              <th scope="col" class="text-right font-medium px-3 py-2">90B MCV b/B</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Credited</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Margin</th>
              <th scope="col" class="text-left font-medium px-3 py-2">gzip</th>
            </tr>
          </thead>
          <tbody class="font-mono text-xs">
            <tr class="border-t border-default">
              <td class="px-3 py-2">crypto (baseline)</td>
              <td class="px-3 py-2">1 MiB</td>
              <td class="px-3 py-2 text-right">8.000</td>
              <td class="px-3 py-2 text-right">7.88</td>
              <td class="px-3 py-2 text-right">—</td>
              <td class="px-3 py-2 text-right">—</td>
              <td class="px-3 py-2">1.000</td>
            </tr>
            <tr class="border-t border-default">
              <td class="px-3 py-2">microphone raw</td>
              <td class="px-3 py-2">32 KiB</td>
              <td class="px-3 py-2 text-right">7.994</td>
              <td class="px-3 py-2 text-right">7.40</td>
              <td class="px-3 py-2 text-right">2</td>
              <td class="px-3 py-2 text-right text-success">3.7×</td>
              <td class="px-3 py-2">1.001</td>
            </tr>
            <tr class="border-t border-default">
              <td class="px-3 py-2">esp32 raw</td>
              <td class="px-3 py-2">1 MiB</td>
              <td class="px-3 py-2 text-right">7.880</td>
              <td class="px-3 py-2 text-right">7.06</td>
              <td class="px-3 py-2 text-right">7</td>
              <td class="px-3 py-2 text-right text-warning">1.01×</td>
              <td class="px-3 py-2">0.992</td>
            </tr>
            <tr class="border-t border-default">
              <td class="px-3 py-2">camera raw</td>
              <td class="px-3 py-2">64 KiB</td>
              <td class="px-3 py-2 text-right">7.969</td>
              <td class="px-3 py-2 text-right">7.02</td>
              <td class="px-3 py-2 text-right">1</td>
              <td class="px-3 py-2 text-right text-success">7.0×</td>
              <td class="px-3 py-2">1.001</td>
            </tr>
            <tr class="border-t border-default">
              <td class="px-3 py-2">jitter raw</td>
              <td class="px-3 py-2">512 KiB</td>
              <td class="px-3 py-2 text-right">2.211</td>
              <td class="px-3 py-2 text-right">1.29</td>
              <td class="px-3 py-2 text-right">0.0625</td>
              <td class="px-3 py-2 text-right text-success">20.6×</td>
              <td class="px-3 py-2">0.100</td>
            </tr>
          </tbody>
        </table>
      </div>

      <HonestNote variant="exact" class="mt-3">
        The ESP32 measures 7.06 b/B against a credited 7 — almost exactly on target, and
        <em>not</em> perfectly white (visible serial correlation and run structure), which is why
        the library still conditions it by default. Jitter is the opposite extreme: heavily
        structured, gzip-compressible to 10 %, and credited at 1/16 bit per delta — a 20× margin
        that is the only reason it is safe to use at all.
      </HonestNote>
    </DemoSection>
  </div>
</template>
