// Directed information flow: build two coupled bit streams (y copies x's past
// with probability `coupling`) and measure transfer entropy each way. The
// asymmetry TE(X→Y) ≫ TE(Y→X) recovers the true driving direction.

import { transferEntropy } from '@mindpeeker/flow'
import { el, fmt, replace } from '../shared/dom'
import { localBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'flow',
  eyebrow: '@mindpeeker/flow',
  title: 'Transfer entropy',
  intro:
    'Transfer entropy measures how much one stream’s past reduces uncertainty about another’s ' +
    'next symbol, beyond that stream’s own past. Here Y copies X’s previous bit with the coupling ' +
    'probability below — so TE(X→Y) should rise with coupling while TE(Y→X) stays near zero.',
})

const N = 4000
const coupling = el('input', {
  type: 'range',
  min: '0',
  max: '100',
  value: '70',
  style: { width: '220px' },
}) as HTMLInputElement
const couplingLabel = el('span', { class: 'mono' }, '0.70')
const bars = el('div', {})

function bar(label: string, te: number, teMax: number, color: string): HTMLElement {
  const pct = Math.min(100, (te / Math.max(teMax, 1e-6)) * 100)
  return el(
    'div',
    { style: { marginBottom: '14px' } },
    el(
      'div',
      { class: 'row', style: { justifyContent: 'space-between' } },
      el('span', {}, label),
      el('span', { class: 'mono' }, `${fmt(te, 4)} bits`),
    ),
    el(
      'div',
      {
        style: {
          height: '14px',
          background: '#0b1119',
          borderRadius: '7px',
          overflow: 'hidden',
          marginTop: '5px',
        },
      },
      el('div', { style: { width: `${pct}%`, height: '100%', background: color } }),
    ),
  )
}

async function run(): Promise<void> {
  const c = Number(coupling.value) / 100
  couplingLabel.textContent = c.toFixed(2)
  const xBytes = await localBytes(Math.ceil(N / 8))
  const freshBytes = await localBytes(Math.ceil(N / 8))
  const decBytes = await localBytes(N)
  const bit = (buf: Uint8Array, i: number) => ((buf[i >> 3] as number) >> (7 - (i & 7))) & 1
  const x = new Uint8Array(N)
  const y = new Uint8Array(N)
  for (let t = 0; t < N; t++) x[t] = bit(xBytes, t)
  y[0] = bit(freshBytes, 0)
  for (let t = 1; t < N; t++) {
    y[t] = (decBytes[t] as number) < c * 256 ? (x[t - 1] as number) : bit(freshBytes, t)
  }
  const teXY = transferEntropy(x, y)
  const teYX = transferEntropy(y, x)
  const teMax = Math.max(teXY, teYX, 0.02)
  replace(
    bars,
    bar('TE(X → Y) — X drives Y', teXY, teMax, '#47e0c8'),
    bar('TE(Y → X) — Y drives X', teYX, teMax, '#7aa2ff'),
    el(
      'p',
      { class: 'note' },
      `net flow X→Y = ${fmt(teXY - teYX, 4)} bits. A random pair sits near zero both ways; coupling lifts X→Y.`,
    ),
  )
}

coupling.addEventListener('input', run)

content.append(
  el(
    'div',
    { class: 'panel' },
    el(
      'div',
      { class: 'row' },
      el('div', {}, el('label', {}, 'Coupling probability'), coupling),
      couplingLabel,
      el('button', { class: 'primary', onclick: run }, 'Resample'),
    ),
  ),
  el(
    'div',
    { class: 'panel', style: { marginTop: '16px' } },
    el('h3', {}, `Transfer entropy over ${N} symbols`),
    bars,
  ),
)

run()
