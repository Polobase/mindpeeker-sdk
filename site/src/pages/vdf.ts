// A Pietrzak verifiable delay function over RSA-2048. Choose T sequential
// squarings; a Web Worker computes the (unshortcuttable) delay, a logarithmic
// proof, then verifies it in a blink — proof time ≪ evaluation time is the
// whole idea.

import { el, fmt, replace } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'vdf',
  eyebrow: '@mindpeeker/vdf',
  title: 'Verifiable delay function',
  intro:
    'Computing y = x^(2^T) mod n needs T sequential squarings that no amount of parallelism can ' +
    'shortcut — a proof of elapsed time. The Pietrzak proof then lets anyone verify it in O(log T) ' +
    'steps. It runs in a Web Worker so the page never freezes.',
})

const select = el(
  'select',
  {},
  el('option', { value: String(2 ** 16) }, 'T = 2¹⁶ (65,536)'),
  el('option', { value: String(2 ** 18), selected: 'selected' }, 'T = 2¹⁸ (262,144)'),
  el('option', { value: String(2 ** 20) }, 'T = 2²⁰ (1,048,576)'),
) as HTMLSelectElement

const runBtn = el('button', { class: 'primary' }, 'Run the delay')
const phase = el('span', { class: 'note' }, 'idle')
const barFill = el('div', {
  style: { width: '0%', height: '100%', background: '#47e0c8', transition: 'width 0.1s' },
})
const bar = el(
  'div',
  {
    style: {
      height: '12px',
      background: '#0b1119',
      borderRadius: '6px',
      overflow: 'hidden',
      margin: '14px 0',
    },
  },
  barFill,
)
const result = el('div', {})

let worker: Worker | undefined

async function run(): Promise<void> {
  const T = Number(select.value)
  runBtn.setAttribute('disabled', 'true')
  replace(result)
  phase.textContent = 'evaluating…'
  barFill.style.width = '0%'
  const input = await getBytes(32)

  worker?.terminate()
  worker = new Worker(new URL('./vdf-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data
    if (m.type === 'progress') barFill.style.width = `${Math.round((m.done / m.total) * 100)}%`
    else if (m.type === 'phase') phase.textContent = `${m.phase}…`
    else if (m.type === 'error') {
      phase.textContent = `error: ${m.message}`
      runBtn.removeAttribute('disabled')
    } else if (m.type === 'done') {
      barFill.style.width = '100%'
      phase.textContent = m.ok ? 'verified ✓' : 'verification FAILED ✗'
      const stat = (k: string, v: string) =>
        el('div', { class: 'stat' }, el('span', { class: 'k' }, k), el('span', { class: 'v' }, v))
      replace(
        result,
        el(
          'div',
          { class: 'grid cols-3' },
          stat('evaluate', `${fmt(m.evalMs, 0)} ms`),
          stat('prove', `${fmt(m.proveMs, 0)} ms`),
          stat('verify', `${fmt(m.verifyMs, 1)} ms`),
        ),
        el(
          'p',
          { class: 'note', style: { marginTop: '12px' } },
          `${m.rounds} halving rounds · output y = ${String(m.y).slice(0, 32)}… (mod RSA-2048)`,
        ),
        el(
          'p',
          { class: 'note' },
          `verification was ${fmt(m.evalMs / Math.max(m.verifyMs, 0.01), 0)}× faster than the delay.`,
        ),
      )
      runBtn.removeAttribute('disabled')
    }
  }
  worker.postMessage({ input, T })
}

runBtn.addEventListener('click', run)

content.append(
  el(
    'div',
    { class: 'panel' },
    el(
      'div',
      { class: 'row' },
      el('div', {}, el('label', {}, 'Sequential squarings'), select),
      runBtn,
      phase,
    ),
    bar,
    result,
  ),
)
