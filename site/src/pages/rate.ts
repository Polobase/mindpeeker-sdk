// Radionics rate calculator: parse a base-44 rate, render its SVG card, and
// show each digit's phase angle. A random rate comes from the CSPRNG.

import { cardGeometry, cardSvg, parseRate, RateError, ratePhases } from '@mindpeeker/rate'
import { el, fmt, replace } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'rate',
  eyebrow: '@mindpeeker/rate',
  title: 'Radionic rate card',
  intro:
    'A Malcolm Rae rate encodes an item as base-44 digits, each a fraction of a turn on a dial. ' +
    'Type a rate (dash- or dot-separated) to render its card geometry as SVG and read every ' +
    'digit’s phase angle, or draw a random rate from your browser’s entropy.',
})

const input = el('input', { type: 'text', value: '12-33-7', placeholder: '12-33-7' })
const svgBox = el('div', { style: { display: 'grid', placeItems: 'center', minHeight: '300px' } })
const infoBox = el('div', {})
const errBox = el('p', { class: 'note' })

function render(): void {
  try {
    const rate = parseRate((input as HTMLInputElement).value.trim())
    svgBox.innerHTML = cardSvg(cardGeometry(rate))
    const svg = svgBox.querySelector('svg')
    if (svg) {
      svg.style.width = '300px'
      svg.style.maxWidth = '100%'
      svg.style.height = 'auto'
    }
    const phases = ratePhases(rate)
    replace(
      infoBox,
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Position'),
            el('th', { class: 'num' }, `Digit (base ${rate.base})`),
            el('th', { class: 'num' }, 'Angle'),
          ),
        ),
        el(
          'tbody',
          {},
          ...rate.digits.map((d, i) =>
            el(
              'tr',
              {},
              el('td', {}, `#${i + 1}`),
              el('td', { class: 'num' }, String(d)),
              el('td', { class: 'num' }, `${fmt(((phases[i] as number) * 180) / Math.PI, 1)}°`),
            ),
          ),
        ),
      ),
    )
    errBox.textContent = ''
  } catch (error) {
    if (error instanceof RateError) errBox.textContent = error.message
    else throw error
  }
}

input.addEventListener('input', render)

const randomBtn = el(
  'button',
  {
    class: 'primary',
    onclick: async () => {
      const bytes = await getBytes(3)
      ;(input as HTMLInputElement).value = [...bytes].map((b) => b % 44).join('-')
      render()
    },
  },
  'Random rate from entropy',
)

content.append(
  el(
    'div',
    { class: 'panel' },
    el(
      'div',
      { class: 'row' },
      el('div', { style: { flex: '1 1 240px' } }, el('label', {}, 'Rate'), input),
      randomBtn,
    ),
    errBox,
  ),
  el(
    'div',
    { class: 'grid cols-2', style: { marginTop: '16px' } },
    el('div', { class: 'panel' }, el('h3', {}, 'Card geometry'), svgBox),
    el('div', { class: 'panel' }, el('h3', {}, 'Phase angles'), infoBox),
  ),
)

render()
