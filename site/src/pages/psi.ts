// A PEAR-style mind-matter experiment on an honest null: choose an intention,
// stream unbiased trials, and watch the cumulative Stouffer Z and the binomial
// Bayes factor. With a fair CSPRNG there is no effect — Z wanders in ±2 and the
// Bayes factor hugs 1. That "nothing" is exactly the point.

import { binomialBayesFactor } from '@mindpeeker/psi'
import { el, fmt } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'psi',
  eyebrow: '@mindpeeker/psi',
  title: 'Mind–matter experiment',
  intro:
    'Each trial is 200 fair coin flips; you aim them high (more 1s), low (more 0s), or idle. The ' +
    'cumulative Stouffer Z and the Bayes factor test your run against pure chance. The mathematics ' +
    'is exact; whether intention moves the number is the open question — and the honest default is no.',
})

const BITS = 200
const intention = el(
  'select',
  {},
  el('option', { value: 'high' }, 'Aim high (more 1s)'),
  el('option', { value: 'low' }, 'Aim low (more 0s)'),
  el('option', { value: 'baseline' }, 'Idle / baseline'),
) as HTMLSelectElement
const canvas = el('canvas', {
  class: 'viz',
  width: '900',
  height: '240',
  style: { height: '240px' },
}) as HTMLCanvasElement
const readoutZ = el('span', { class: 'v' }, '—')
const readoutBF = el('span', { class: 'v' }, '—')
const readoutN = el('span', { class: 'v' }, '0')

let hits = 0
let bits = 0
const zs: number[] = []

function popcount(b: number): number {
  let c = 0
  for (let i = 0; i < 8; i++) c += (b >> i) & 1
  return c
}

function draw(): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const Hc = canvas.height
  ctx.fillStyle = '#070b11'
  ctx.fillRect(0, 0, W, Hc)
  const mid = Hc / 2
  const yOf = (z: number) => mid - (z / 4) * (Hc / 2 - 10)
  // ±2 band + zero line
  ctx.fillStyle = 'rgba(122,162,255,0.10)'
  ctx.fillRect(0, yOf(2), W, yOf(-2) - yOf(2))
  ctx.strokeStyle = '#2b3a4d'
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(W, mid)
  ctx.stroke()
  if (zs.length < 2) return
  ctx.strokeStyle = '#47e0c8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < zs.length; i++) {
    const x = (i / (zs.length - 1)) * W
    const y = Math.max(2, Math.min(Hc - 2, yOf(zs[i] as number)))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

async function runBatch(trials: number): Promise<void> {
  const aim = intention.value
  for (let t = 0; t < trials; t++) {
    const bytes = await getBytes(BITS / 8)
    let ones = 0
    for (const b of bytes) ones += popcount(b)
    hits += aim === 'low' ? BITS - ones : ones
    bits += BITS
    const z = (hits - bits / 2) / Math.sqrt(bits / 4)
    zs.push(z)
  }
  const z = zs[zs.length - 1] ?? 0
  const bf = binomialBayesFactor(hits, bits)
  readoutZ.textContent = fmt(z, 2)
  readoutBF.textContent = fmt(bf, 3)
  readoutN.textContent = `${zs.length}`
  draw()
}

function reset(): void {
  hits = 0
  bits = 0
  zs.length = 0
  readoutZ.textContent = '—'
  readoutBF.textContent = '—'
  readoutN.textContent = '0'
  draw()
}

const stat = (k: string, v: HTMLElement) =>
  el('div', { class: 'stat' }, el('span', { class: 'k' }, k), v)

content.append(
  el(
    'div',
    { class: 'panel' },
    el(
      'div',
      { class: 'row' },
      el('div', {}, el('label', {}, 'Intention'), intention),
      el('button', { class: 'primary', onclick: () => runBatch(100) }, 'Run 100 trials'),
      el('button', { onclick: reset }, 'Reset'),
    ),
  ),
  el(
    'div',
    { class: 'panel grid cols-3', style: { margin: '16px 0' } },
    stat('trials', readoutN),
    stat('cumulative Stouffer Z', readoutZ),
    stat('Bayes factor (BF₁₀)', readoutBF),
  ),
  el('div', { class: 'panel' }, el('h3', {}, 'Cumulative Z vs the ±2 chance band'), canvas),
)

reset()
