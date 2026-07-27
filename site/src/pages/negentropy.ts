// Randomness health battery: run a suite of @mindpeeker/negentropy estimators
// over a fresh CSPRNG sample and show a byte histogram.

import {
  chiSquareBytes,
  monobit,
  runsTest,
  serialCorrelation,
  shannonEntropy,
  spectralTest,
} from '@mindpeeker/negentropy'
import { el, fmt, replace } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'negentropy',
  eyebrow: '@mindpeeker/negentropy',
  title: 'Randomness health battery',
  intro:
    'The estimators behind the SDK’s order-detection stack, run live over a 4 KB sample of your ' +
    'browser’s CSPRNG. Ideal randomness sits near 8 bits/byte of entropy, p-values scattered in ' +
    '[0, 1], and z-scores near zero — structure would push them to the extremes.',
})

const N = 4096
const table = el('div', { class: 'tbl-scroll' })
const canvas = el('canvas', {
  class: 'viz',
  width: '1024',
  height: '200',
  style: { height: '200px' },
}) as HTMLCanvasElement

function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = (b >> (7 - k)) & 1
  }
  return bits
}

function drawHistogram(bytes: Uint8Array): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#070b11'
  ctx.fillRect(0, 0, W, H)
  const hist = new Float64Array(256)
  for (const b of bytes) hist[b] = (hist[b] as number) + 1
  const max = Math.max(1, ...hist)
  const bw = W / 256
  ctx.fillStyle = '#47e0c8'
  for (let i = 0; i < 256; i++) {
    const h = ((hist[i] as number) / max) * (H - 4)
    ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h)
  }
  const expected = bytes.length / 256
  const y = H - (expected / max) * (H - 4)
  ctx.strokeStyle = '#8b97a7'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(W, y)
  ctx.stroke()
  ctx.setLineDash([])
}

function row(name: string, value: string, note: string): HTMLElement {
  return el(
    'tr',
    {},
    el('td', {}, name),
    el('td', { class: 'num' }, value),
    el('td', { class: 'note' }, note),
  )
}

async function run(): Promise<void> {
  const bytes = await getBytes(N)
  const bits = bytesToBits(bytes)
  const chi = chiSquareBytes(bytes)
  const mb = monobit(bits)
  const spec = spectralTest(bits)
  replace(
    table,
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Test'),
          el('th', { class: 'num' }, 'Statistic'),
          el('th', {}, 'Reading'),
        ),
      ),
      el(
        'tbody',
        {},
        row('Shannon entropy', `${fmt(shannonEntropy(bytes), 4)}`, 'bits/byte — ideal 8.0'),
        row('χ² uniformity (255 df)', fmt(chi.statistic, 1), `p = ${fmt(chi.pValue, 3)}`),
        row('Monobit', `z = ${fmt(mb.z, 2)}`, `ones ${fmt(mb.onesFraction * 100, 2)}%`),
        row('Runs test', `z = ${fmt(runsTest(bits), 2)}`, 'alternation of bits'),
        row('Serial correlation', fmt(serialCorrelation(bytes), 4), 'lag-1 — ideal 0'),
        row('Spectral (DFT)', `p = ${fmt(spec.pValue, 3)}`, 'hidden periodicity'),
      ),
    ),
  )
  drawHistogram(bytes)
}

content.append(
  el(
    'div',
    { class: 'controls' },
    el('button', { class: 'primary', onclick: run }, 'Draw a fresh 4 KB sample'),
    el('span', { class: 'note' }, `${N} bytes from crypto.getRandomValues`),
  ),
  el(
    'div',
    { class: 'grid cols-2' },
    el('div', { class: 'panel' }, el('h3', {}, 'Test battery'), table),
    el('div', { class: 'panel' }, el('h3', {}, 'Byte histogram (0–255)'), canvas),
  ),
)

run()
