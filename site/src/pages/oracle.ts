// Divination systems drawn from the browser CSPRNG: I-Ching, Tarot, runes,
// geomancy. Every draw reports the exact bytes it consumed.

import { castHexagram, castRunes, castShield, castSpread } from '@mindpeeker/oracle'
import { el, replace } from '../shared/dom'
import { stream } from '../shared/entropy'
import { shell } from '../shared/layout'

const content = shell({
  active: 'oracle',
  eyebrow: '@mindpeeker/oracle',
  title: 'Divination from entropy',
  intro:
    'Map an entropy stream to a symbolic system with exact, unbiased probabilities — the I-Ching, ' +
    'a Tarot spread, an Elder Futhark rune draw, or a geomancy shield. Each cast is reproducible ' +
    'from the bytes it consumed; the mathematics is asserted, the meaning is not.',
})

const out = el(
  'div',
  { class: 'panel', style: { minHeight: '220px' } },
  el('p', { class: 'note' }, 'Pick a system to cast it from crypto.getRandomValues.'),
)

function head(label: string, bytes: number, headline: string): HTMLElement {
  return el(
    'div',
    { class: 'stat' },
    el('span', { class: 'k' }, `${label} · ${bytes} byte(s) of entropy`),
    el('span', { class: 'v' }, headline),
  )
}

function line(yang: boolean, changing: boolean): HTMLElement {
  return el(
    'div',
    {
      class: 'mono',
      style: {
        fontSize: '20px',
        letterSpacing: '2px',
        color: changing ? 'var(--accent)' : 'var(--text)',
      },
    },
    `${yang ? '▬▬▬▬▬▬▬' : '▬▬▬  ▬▬▬'}${changing ? '  ✳' : ''}`,
  )
}

async function iching(): Promise<void> {
  const c = await castHexagram(stream())
  replace(
    out,
    head(
      'I-Ching',
      c.bytesConsumed,
      `${c.primary.character}  #${c.primary.kingWen} · ${c.primary.name.en}`,
    ),
    el(
      'div',
      { style: { margin: '14px 0' } },
      ...[...c.lines].reverse().map((l) => line(l.yang, l.changing)),
    ),
    el(
      'p',
      { class: 'note' },
      c.relating
        ? `changing lines ${c.changing.join(', ')} → relating #${c.relating.kingWen} ${c.relating.name.en}`
        : 'a stable hexagram — no changing lines',
    ),
  )
}

async function tarot(): Promise<void> {
  const c = await castSpread(stream(), 'threeCard', { reversals: true })
  replace(
    out,
    head('Tarot', c.bytesConsumed, c.spread.name),
    el(
      'div',
      { class: 'grid cols-3', style: { marginTop: '14px' } },
      ...c.cards.map((d) =>
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'pkg' }, d.position.name),
          el('h3', {}, d.card.name),
          el('p', {}, `${d.card.arcana}${d.reversed ? ' · reversed' : ''}`),
        ),
      ),
    ),
  )
}

async function runes(): Promise<void> {
  const c = await castRunes(stream(), 3, { merkstave: true })
  replace(
    out,
    head('Elder Futhark', c.bytesConsumed, c.runes.map((d) => d.rune.glyph).join('  ')),
    el(
      'div',
      { class: 'grid cols-3', style: { marginTop: '14px' } },
      ...c.runes.map((d) =>
        el(
          'div',
          { class: 'card' },
          el('div', { style: { fontSize: '40px', lineHeight: '1' } }, d.rune.glyph),
          el(
            'h3',
            { style: { marginTop: '8px' } },
            `${d.rune.name}${d.merkstave ? ' (merkstave)' : ''}`,
          ),
          el('p', {}, `${d.rune.aettName}’s ætt`),
        ),
      ),
    ),
  )
}

async function geomancy(): Promise<void> {
  const c = await castShield(stream())
  replace(
    out,
    head('Geomancy', c.bytesConsumed, `Judge: ${c.judge.name} — ${c.judge.meaning}`),
    el(
      'p',
      { class: 'note', style: { marginTop: '10px' } },
      `Witnesses: ${c.witnesses[0].name} (right), ${c.witnesses[1].name} (left).`,
    ),
    el(
      'div',
      { class: 'grid cols-2', style: { marginTop: '12px' } },
      ...c.mothers.map((f, i) =>
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'pkg' }, `Mother ${i + 1}`),
          el('h3', {}, f.name),
          el('p', {}, f.meaning),
        ),
      ),
    ),
  )
}

const run = (fn: () => Promise<void>) => async () => {
  try {
    await fn()
  } catch (error) {
    replace(
      out,
      el(
        'p',
        { class: 'note' },
        `cast failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  }
}

content.append(
  el(
    'div',
    { class: 'controls' },
    el('button', { class: 'primary', onclick: run(iching) }, 'I-Ching'),
    el('button', { onclick: run(tarot) }, 'Tarot (three-card)'),
    el('button', { onclick: run(runes) }, 'Runes (three)'),
    el('button', { onclick: run(geomancy) }, 'Geomancy shield'),
  ),
  out,
)
