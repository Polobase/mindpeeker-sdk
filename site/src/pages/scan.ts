// Radionic scan: rank a catalog of items by an entropy "race" energy and an
// honest chance-deviation null model. Energies and vitalities have no chance
// baseline; only the deviation z/p/Bayes factor does — and over many items some
// look strong by luck. That caveat is the whole point.

import { defineCatalog, scan } from '@mindpeeker/scan'
import { el, fmt, replace } from '../shared/dom'
import { provider } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'scan',
  eyebrow: '@mindpeeker/scan',
  title: 'Radionic scan',
  intro:
    'An AetherOne-style scan composed from unbiased primitives: a race ranks a random subset by ' +
    'energy, and a chance-deviation model scores every item against a fair-coin null. A high score ' +
    'flags a departure from chance — not evidence of intention. Edit the catalog and scan.',
})

const textarea = el('textarea', {
  rows: '9',
  style: { fontFamily: 'var(--mono)' },
}) as HTMLTextAreaElement
textarea.value = [
  'Rest',
  'Movement',
  'Water',
  'Fire',
  'Focus',
  'Release',
  'Grounding',
  'Clarity',
  'Balance',
  'Vitality',
].join('\n')

const out = el('div', { class: 'tbl-scroll' })
const btn = el('button', { class: 'primary' }, 'Scan catalog')

function bar(pct: number): HTMLElement {
  return el(
    'div',
    {
      style: {
        height: '10px',
        width: '80px',
        background: '#0b1119',
        borderRadius: '5px',
        overflow: 'hidden',
      },
    },
    el('div', {
      style: { width: `${Math.round(pct * 100)}%`, height: '100%', background: '#47e0c8' },
    }),
  )
}

async function run(): Promise<void> {
  const items = textarea.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name }))
  if (items.length < 3) {
    replace(out, el('p', { class: 'note' }, 'add at least 3 items'))
    return
  }
  btn.setAttribute('disabled', 'true')
  try {
    const report = await scan(defineCatalog('demo', 'Demo catalog', items), provider, {
      deviationRounds: 128,
    })
    replace(
      out,
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, '#'),
            el('th', {}, 'Item'),
            el('th', {}, 'Energy'),
            el('th', { class: 'num' }, 'Vitality'),
            el('th', { class: 'num' }, 'z'),
            el('th', { class: 'num' }, 'BF₁₀'),
          ),
        ),
        el(
          'tbody',
          {},
          ...report.results.map((r) =>
            el(
              'tr',
              {},
              el('td', { class: 'num' }, String(r.rank)),
              el('td', {}, r.name),
              el('td', {}, r.energy === undefined ? '—' : bar(r.energy)),
              el(
                'td',
                { class: 'num' },
                r.vitality === undefined ? '—' : String(Math.round(r.vitality)),
              ),
              el('td', { class: 'num' }, r.deviation ? fmt(r.deviation.z, 2) : '—'),
              el('td', { class: 'num' }, r.deviation ? fmt(r.deviation.bayesFactor, 2) : '—'),
            ),
          ),
        ),
      ),
      el(
        'p',
        { class: 'note' },
        `${report.numberOfTrials} race passes · ${report.accounting.bytesConsumed} bytes from “${report.source}”. With ${items.length} items, expect ~${(0.05 * items.length).toFixed(1)} to cross p<0.05 by chance.`,
      ),
    )
  } finally {
    btn.removeAttribute('disabled')
  }
}

btn.addEventListener('click', run)

content.append(
  el(
    'div',
    { class: 'grid cols-2' },
    el(
      'div',
      { class: 'panel' },
      el('label', {}, 'Catalog (one item per line)'),
      textarea,
      el('div', { style: { marginTop: '12px' } }, btn),
    ),
    el('div', { class: 'panel' }, el('h3', {}, 'Ranked results'), out),
  ),
)

run()
