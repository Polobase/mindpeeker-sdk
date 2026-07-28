// Gematria calculator: profile table across every applicable cipher, per-letter
// breakdown, equal-value lookup against the bundled Sepher Sephiroth, and an
// entropy-driven word draw.

import {
  analyze,
  atbash,
  CIPHERS,
  lookup,
  matches,
  profile,
  reduce,
  value,
} from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'
import { drawWord } from '@mindpeeker/gematria/oracle'
import { el, fmt, replace } from '../shared/dom'
import { getBytes } from '../shared/entropy'
import { shell } from '../shared/layout'
import { loadWordLibrary } from '../shared/words'

// Registers the bundled lexicon as the default (for the 2-arg matches/lookup).
const LEXICON = defaultLexicon()

const content = shell({
  active: 'gematria',
  eyebrow: '@mindpeeker/gematria',
  title: 'Gematria calculator',
  intro:
    'Assign numeric values to a word’s letters and relate words of equal value — Hebrew, Greek, ' +
    'Arabic and English/Latin, across 41 exact-integer ciphers including Peter Plichta’s Prime ' +
    'Number Cross. Computation is exact; what equal values mean is a contested tradition.',
})

const state = { text: 'wisdom', focus: 'en-ordinal', reverse: false }

const input = el('input', {
  type: 'text',
  value: state.text,
  placeholder: 'type a word — try אהבה, θελημα, or wisdom',
  oninput: (e: Event) => {
    state.text = (e.target as HTMLInputElement).value
    render()
  },
})

const focusSelect = el('select', {
  onchange: (e: Event) => {
    state.focus = (e.target as HTMLSelectElement).value
    render()
  },
})

const reverseToggle = el('input', {
  type: 'checkbox',
  onchange: (e: Event) => {
    state.reverse = (e.target as HTMLInputElement).checked
    render()
  },
}) as HTMLInputElement

const scriptBadge = el('span', { class: 'badge' }, '—')
const profileBox = el('div', { class: 'tbl-scroll' })
const breakdownBox = el('div', {})
const matchBox = el('div', {})
const oracleBox = el('div', {})

// --- reverse lookup (number → words) ---
const lookupInput = el('input', { type: 'number', value: '93', min: '0' })
const lookupOut = el('div', { class: 'note' })
const lookupBtn = el(
  'button',
  {
    onclick: () => {
      const n = Number.parseInt((lookupInput as HTMLInputElement).value, 10)
      if (!Number.isFinite(n) || n < 0) return
      const r = lookup(n, state.focus)
      replace(
        lookupOut,
        r.matches.length
          ? `${r.matches.slice(0, 14).join('  ·  ')}${r.matches.length > 14 ? ' …' : ''}  — commonness ${(r.commonness * 100).toFixed(1)}%`
          : `no lexicon word has ${state.focus} value ${n}`,
      )
    },
  },
  'Look up',
)

// --- oracle draw ---
const drawBtn = el(
  'button',
  {
    class: 'primary',
    onclick: async () => {
      ;(drawBtn as HTMLButtonElement).disabled = true
      try {
        const lib = await loadWordLibrary()
        const bytes = await getBytes(64)
        const { word, bytesConsumed } = await drawWord(lib, bytes)
        const v = analyze(word, state.focus).value
        const peers = matches(word, lib, state.focus).exact.filter((w) => w !== word)
        replace(
          oracleBox,
          el(
            'div',
            { class: 'stat' },
            el('span', { class: 'k' }, `drew a word · ${bytesConsumed} byte(s) · ${state.focus}`),
            el('span', { class: 'v' }, `${word} = ${fmt(v)}`),
          ),
          el(
            'p',
            { class: 'note' },
            `reduced ${reduce(v)}${peers.length ? ` · also = ${peers.slice(0, 8).join(', ')}` : ' · no equal-value word in the list'}`,
          ),
        )
      } finally {
        ;(drawBtn as HTMLButtonElement).disabled = false
      }
    },
  },
  'Draw a word from entropy',
)

function rebuildFocus(script: string): void {
  const applicable = CIPHERS.filter((c) => c.script === script)
  if (!applicable.some((c) => c.id === state.focus)) {
    state.focus = applicable[0]?.id ?? 'en-ordinal'
  }
  replace(focusSelect, ...applicable.map((c) => el('option', { value: c.id }, c.label)))
  ;(focusSelect as HTMLSelectElement).value = state.focus
}

function render(): void {
  const p = profile(state.text, { includeExtended: true })
  scriptBadge.textContent = `${p.script} · ${p.values.length} ciphers`
  rebuildFocus(p.script)

  // Full profile table.
  replace(
    profileBox,
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Cipher'),
          el('th', { class: 'num' }, 'Value'),
          el('th', { class: 'num' }, 'Reduced'),
        ),
      ),
      el(
        'tbody',
        {},
        ...p.values.map((v) =>
          el(
            'tr',
            {},
            el('td', {}, v.label),
            el('td', { class: 'num' }, fmt(v.value)),
            el('td', { class: 'num' }, String(v.reduced)),
          ),
        ),
      ),
    ),
  )

  // Per-letter breakdown for the focus cipher (optionally reversed).
  const a = analyze(state.text, state.focus, { reverse: state.reverse })
  replace(
    breakdownBox,
    el(
      'div',
      { class: 'stat' },
      el(
        'span',
        { class: 'k' },
        `${state.focus}${state.reverse ? ' · reverse' : ''} · reduced ${reduce(a.value)}`,
      ),
      el('span', { class: 'v' }, fmt(a.value)),
    ),
    el(
      'p',
      { class: 'mono note', style: { marginTop: '10px', fontSize: '14px' } },
      a.byLetter.length
        ? a.byLetter.map((b) => `${b.char}=${b.value}`).join('  +  ')
        : '(no letters of this script)',
    ),
    el('p', { class: 'note' }, `atbash: ${atbash(state.text) || '—'}`),
  )

  // Equal-value matches under the focus cipher (respecting the reverse toggle).
  const peers = LEXICON.filter((w) => value(w, state.focus, state.reverse) === a.value)
  replace(
    matchBox,
    el(
      'p',
      {},
      peers.length
        ? `${a.value} also = ${peers.slice(0, 14).join(', ')}${peers.length > 14 ? ' …' : ''}`
        : `no lexicon word equals ${a.value} under ${state.focus}${state.reverse ? ' (reverse)' : ''}`,
    ),
    el(
      'p',
      { class: 'note' },
      `commonness ${((peers.length / LEXICON.length) * 100).toFixed(1)}% — the fraction of the ${LEXICON.length}-word Sepher Sephiroth at this value. Equal-value coincidences are statistically cheap.`,
    ),
  )
}

content.append(
  el(
    'div',
    { class: 'panel' },
    el(
      'div',
      { class: 'row' },
      el('div', { style: { flex: '1 1 260px' } }, el('label', {}, 'Word or phrase'), input),
      el('div', {}, el('label', {}, 'Focus cipher'), focusSelect),
      el(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: 'var(--muted)',
          },
        },
        reverseToggle,
        el('span', {}, 'reverse'),
      ),
      scriptBadge,
    ),
  ),
  el(
    'div',
    { class: 'grid cols-2', style: { marginTop: '16px' } },
    el('div', { class: 'panel' }, el('h3', {}, 'Every cipher'), profileBox),
    el(
      'div',
      { class: 'grid', style: { gap: '16px' } },
      el('div', { class: 'panel' }, el('h3', {}, 'Focus cipher'), breakdownBox),
      el('div', { class: 'panel' }, el('h3', {}, 'Equal-value words'), matchBox),
      el(
        'div',
        { class: 'panel' },
        el('h3', {}, 'Reverse lookup'),
        el(
          'div',
          { class: 'row' },
          el('div', { style: { flex: '1' } }, el('label', {}, 'Number'), lookupInput),
          lookupBtn,
        ),
        lookupOut,
      ),
      el('div', { class: 'panel' }, el('h3', {}, 'Entropy oracle'), drawBtn, oracleBox),
    ),
  ),
)

render()
