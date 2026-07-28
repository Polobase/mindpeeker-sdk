// The WebGL2 dashboard, server-free: it reuses the visualizer package's panel
// grid (via mountDashboard) but drives every channel from the browser CSPRNG
// plus @mindpeeker/negentropy statistics, instead of a WebSocket server.

import {
  chiSquareBytes,
  cumulativeDeviation,
  monobit,
  shannonEntropy,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import { mountDashboard } from '@viz/client/mount'
import { PROTOCOL_VERSION } from '@viz/src/protocol'
import type { DirectoryMessage } from '@viz/src/types'
import { el, fmt } from '../shared/dom'
import { localBytes } from '../shared/entropy'
import { shell } from '../shared/layout'
import './visualizer.css'

const content = shell({
  active: 'visualizer',
  eyebrow: '@mindpeeker/visualizer',
  title: 'Live entropy dashboard',
  intro:
    'The package’s hand-rolled WebGL2 panels, driven entirely in your browser: a scrolling byte ' +
    'bitmap, Shannon entropy per chunk, a GCP-style cumulative-deviation walk against its χ² ' +
    'significance envelope, and a byte-value density heatmap. The bytes come from your CSPRNG — ' +
    'no server, no socket.',
})

const stat = (k: string) => {
  const v = el('span', { class: 'v' }, '—')
  return { node: el('div', { class: 'stat' }, el('span', { class: 'k' }, k), v), v }
}
const sh = stat('Shannon (bits/byte)')
const chi = stat('χ² p-value')
const mz = stat('monobit z')

let running = true
const toggle = el(
  'button',
  {
    class: 'primary',
    onclick: () => {
      running = !running
      toggle.textContent = running ? 'Pause' : 'Resume'
    },
  },
  'Pause',
)

const grid = el('main', { class: 'viz-dash' })
content.append(
  el(
    'div',
    { class: 'controls' },
    toggle,
    el('span', { class: 'note' }, 'streaming crypto.getRandomValues → panels'),
  ),
  el(
    'div',
    { class: 'panel grid cols-3', style: { marginBottom: '16px' } },
    sh.node,
    chi.node,
    mz.node,
  ),
  grid,
)

const dashboard = mountDashboard(grid)
const directory: DirectoryMessage = {
  type: 'directory',
  version: PROTOCOL_VERSION,
  channels: [
    { id: 0, name: 'CSPRNG bytes', kind: 'bytes', status: 'live' },
    { id: 1, name: 'Shannon entropy (bits/byte)', kind: 'series', status: 'live' },
    { id: 2, name: 'Cumulative deviation vs χ² envelope', kind: 'series', status: 'live' },
    { id: 3, name: 'Byte-value density (16×16)', kind: 'matrix', status: 'live' },
  ],
}
dashboard.applyDirectory(directory)

function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = (b >> (7 - k)) & 1
  }
  return bits
}

let step = 0
let run: number[] = []
const hist = new Float32Array(256)

async function tick(): Promise<void> {
  if (!running) return
  const chunk = await localBytes(256)
  dashboard.pushFrame({ kind: 'bytes', channelId: 0, bytes: chunk })

  const h = shannonEntropy(chunk)
  dashboard.pushFrame({ kind: 'series', channelId: 1, points: [{ t: step, value: h }] })

  const mb = monobit(bytesToBits(chunk))
  run.push(mb.z)
  if (run.length > 512) run = [mb.z] // fresh GCP-style run to keep it bounded
  const cd = cumulativeDeviation(run)
  const env = significanceEnvelope(run.length)
  const i = run.length - 1
  const bound = env[i] as number
  dashboard.pushFrame({
    kind: 'series',
    channelId: 2,
    points: [{ t: step, value: cd[i] as number, band: [-bound, bound] }],
  })

  for (const b of chunk) hist[b] = (hist[b] as number) + 1
  let max = 1
  for (const v of hist) if (v > max) max = v
  const data = new Float32Array(256)
  for (let j = 0; j < 256; j++) data[j] = (hist[j] as number) / max
  dashboard.pushFrame({ kind: 'matrix', channelId: 3, rows: 16, cols: 16, data })

  const cs = chiSquareBytes(chunk)
  sh.v.textContent = fmt(h, 3)
  chi.v.textContent = fmt(cs.pValue, 3)
  mz.v.textContent = fmt(mb.z, 2)
  step++
}

setInterval(tick, 90)
