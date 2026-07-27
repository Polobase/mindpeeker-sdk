// Randonautica-style spatial field: draw an area-uniform point cloud from
// entropy, detect its densest (attractor) and sparsest (void) neighbourhoods,
// and score departure from complete spatial randomness with Clark–Evans.

import { attractors, clarkEvans, type Point, sampleField } from '@mindpeeker/field'
import { el, fmt, replace } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'field',
  eyebrow: '@mindpeeker/field',
  title: 'Spatial field & attractors',
  intro:
    'A field sampled from a good RNG is complete spatial randomness (CSR) — so its “attractors” ' +
    'are the chance clustering any random field shows. Each hotspot carries a Poisson tail ' +
    'p-value under CSR: the honest measure of how ordinary it is. Reseed to draw a new field.',
})

const SIZE = 600
const COUNT = 360
const REGION = { kind: 'rect', width: 1, height: 1 } as const
const canvas = el('canvas', {
  class: 'viz',
  width: String(SIZE),
  height: String(SIZE),
  style: { width: '100%', maxWidth: `${SIZE}px`, aspectRatio: '1' },
}) as HTMLCanvasElement
const statsBox = el('div', { class: 'grid cols-2' })

function draw(points: readonly Point[], res: ReturnType<typeof attractors>): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#070b11'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = '#7aa2ff'
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(p.x * SIZE, p.y * SIZE, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  const ring = (hot: { point: Point }, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(hot.point.x * SIZE, hot.point.y * SIZE, res.radius * SIZE, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(hot.point.x * SIZE, hot.point.y * SIZE, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ring(res.attractor, '#47e0c8')
  ring(res.void, '#ffb454')
}

function stat(k: string, v: string, note: string): HTMLElement {
  return el(
    'div',
    { class: 'panel' },
    el('div', { class: 'stat' }, el('span', { class: 'k' }, k), el('span', { class: 'v' }, v)),
    el('p', { class: 'note' }, note),
  )
}

async function reseed(): Promise<void> {
  const bytes = await getBytes(COUNT * 8 + 32)
  const { points } = await sampleField(bytes, COUNT, REGION)
  const res = attractors(points, REGION, { expectedNeighbours: 5 })
  const ce = clarkEvans(points, REGION)
  draw(points, res)
  replace(
    statsBox,
    stat(
      'Attractor',
      `${res.attractor.neighbours} nb`,
      `densest neighbourhood · Poisson p = ${fmt(res.attractor.pValue, 3)}`,
    ),
    stat(
      'Void',
      `${res.void.neighbours} nb`,
      `sparsest neighbourhood · Poisson p = ${fmt(res.void.pValue, 3)}`,
    ),
    stat(
      'Clark–Evans',
      `z = ${fmt(ce.z, 2)}`,
      `nearest-neighbour vs CSR · p = ${fmt(ce.pValue, 3)}`,
    ),
    stat(
      'Field',
      `${COUNT} pts`,
      `radius ${fmt(res.radius, 3)} · μ ${fmt(res.expectedNeighbours, 2)} nb/pt under CSR`,
    ),
  )
}

content.append(
  el(
    'div',
    { class: 'controls' },
    el('button', { class: 'primary', onclick: reseed }, 'Reseed field'),
    el('span', { class: 'note' }, 'green = attractor, orange = void'),
  ),
  el(
    'div',
    { class: 'grid cols-2' },
    el('div', { class: 'panel', style: { display: 'grid', placeItems: 'center' } }, canvas),
    statsBox,
  ),
)

reseed()
