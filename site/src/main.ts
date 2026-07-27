// Landing page: hero + a grouped grid of package cards.

import { el } from './shared/dom'
import { footer, header } from './shared/layout'
import { GROUP_LABELS, PACKAGES, type PackageEntry, pageHref, REPO_URL } from './shared/manifest'

function card(p: PackageEntry): HTMLElement {
  return el(
    'a',
    { class: 'card', href: pageHref(p.id) },
    el('div', { class: 'pkg' }, p.pkg),
    el('h3', {}, p.title),
    el('p', {}, p.tagline),
  )
}

function group(kind: PackageEntry['group']): HTMLElement {
  const items = PACKAGES.filter((p) => p.group === kind)
  return el(
    'section',
    { class: 'group' },
    el('h2', { class: 'group-h' }, GROUP_LABELS[kind]),
    el('div', { class: 'grid cols-3' }, ...items.map(card)),
  )
}

const hero = el(
  'section',
  { class: 'hero' },
  el(
    'div',
    { class: 'wrap' },
    el('div', { class: 'eyebrow' }, 'mindpeeker-sdk'),
    el(
      'h1',
      {},
      'Rigorous randomness, frontier research —',
      el('br'),
      'running entirely in your browser.',
    ),
    el(
      'p',
      { class: 'lede' },
      'A workspace of zero-dependency ESM packages bridging NIST-grade entropy engineering and the ' +
        'statistical machinery of consciousness research. Every demo below draws live from your ' +
        'browser’s CSPRNG — no server, no telemetry.',
    ),
    el(
      'div',
      { class: 'cta' },
      el('a', { class: 'btn primary', href: pageHref('gematria') }, 'Open the gematria calculator'),
      el(
        'a',
        { class: 'btn', href: REPO_URL, target: '_blank', rel: 'noreferrer' },
        'Source on GitHub ↗',
      ),
    ),
  ),
)

document.body.append(
  header('home'),
  el(
    'main',
    {},
    hero,
    el('div', { class: 'wrap' }, group('frontier'), group('randomness'), group('tools')),
  ),
  footer(),
)
