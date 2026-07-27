// The entropy source itself: a scrolling bit rain from the CSPRNG, live
// throughput and Shannon entropy, and the provider abstraction that fronts
// ~30 backends (only the browser-native ones run here without a server).

import { shannonEntropy } from '@mindpeeker/negentropy'
import { el, fmt } from '../shared/dom'
import { getBytes, provider } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'entropy',
  eyebrow: '@mindpeeker/entropy',
  title: 'Entropy source',
  intro:
    'Every provider exposes the same shape — a named source with a byte stream and SP 800-90B ' +
    'health accounting — so a QRNG, a public beacon, or your browser’s CSPRNG all plug in ' +
    'identically. This page rains bits straight from crypto.getRandomValues.',
})

const W = 256
const H = 200
const canvas = el('canvas', {
  class: 'viz',
  width: String(W),
  height: String(H),
  style: { height: `${H}px`, imageRendering: 'pixelated' },
}) as HTMLCanvasElement

const st = (k: string) => {
  const v = el('span', { class: 'v' }, '—')
  return { node: el('div', { class: 'stat' }, el('span', { class: 'k' }, k), v), v }
}
const rate = st('throughput')
const ent = st('Shannon (bits/byte)')
const src = st('source')
src.v.textContent = `${provider.name} · ${provider.kind}`

const PROVIDERS: readonly (readonly [string, string])[] = [
  ['crypto', 'browser CSPRNG — live here'],
  ['jitter', 'CPU timing jitter — live here'],
  ['camera', 'webcam sensor noise'],
  ['drand', 'League of Entropy beacon'],
  ['curby', 'CU Boulder beacon'],
  ['nistBeacon', 'NIST randomness beacon'],
  ['anu', 'ANU quantum vacuum'],
  ['bitcoin', 'Bitcoin block hashes'],
  ['esp32', 'ESP32 TRNG over serial'],
  ['hwRng', 'Linux /dev/hwrng'],
]

let bytesSeen = 0
let lastMark = 0
let lastBytes = 0

async function tick(now: number): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(canvas, 0, -1)
    const rowBytes = W / 8
    const chunk = await getBytes(rowBytes)
    bytesSeen += rowBytes
    for (let x = 0; x < W; x++) {
      const bit = ((chunk[x >> 3] as number) >> (7 - (x & 7))) & 1
      ctx.fillStyle = bit ? '#47e0c8' : '#0b1119'
      ctx.fillRect(x, H - 1, 1, 1)
    }
    ent.v.textContent = fmt(shannonEntropy(chunk), 2)
  }
  if (now - lastMark > 500) {
    const bps = ((bytesSeen - lastBytes) * 1000) / (now - lastMark)
    rate.v.textContent = `${fmt(bps / 1024, 1)} KB/s`
    lastMark = now
    lastBytes = bytesSeen
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

content.append(
  el(
    'div',
    { class: 'panel grid cols-3', style: { marginBottom: '16px' } },
    rate.node,
    ent.node,
    src.node,
  ),
  el(
    'div',
    { class: 'grid cols-2' },
    el('div', { class: 'panel', style: { display: 'grid', placeItems: 'center' } }, canvas),
    el(
      'div',
      { class: 'panel' },
      el('h3', {}, 'Providers (one interface, many backends)'),
      el(
        'div',
        { class: 'grid', style: { gap: '8px', marginTop: '8px' } },
        ...PROVIDERS.map(([name, note]) =>
          el(
            'div',
            { class: 'row', style: { justifyContent: 'space-between', gap: '10px' } },
            el('span', { class: 'mono', style: { color: 'var(--accent)' } }, name),
            el('span', { class: 'note' }, note),
          ),
        ),
      ),
    ),
  ),
)
