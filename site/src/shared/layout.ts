// Shared page chrome: the sticky top nav and the footer, plus a `shell()` that
// wraps a page's body and returns its content container. Importing this pulls
// the shared theme into every page bundle.

import './theme.css'
import { el } from './dom'
import { PACKAGES, pageHref, REPO_URL } from './manifest'

export function header(active?: string): HTMLElement {
  if (!document.querySelector('link[rel="icon"]')) {
    document.head.append(
      el('link', { rel: 'icon', href: `${import.meta.env.BASE_URL}favicon.svg` }),
    )
  }
  const links = [
    el('a', { href: pageHref(''), class: active === 'home' ? 'active' : '' }, 'Home'),
    ...PACKAGES.map((p) =>
      el('a', { href: pageHref(p.id), class: p.id === active ? 'active' : '' }, p.title),
    ),
  ]
  return el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'bar' },
      el(
        'a',
        { class: 'brand', href: pageHref('') },
        el('span', { class: 'dot' }),
        'mindpeeker-sdk',
      ),
      el('nav', { class: 'nav' }, ...links),
    ),
  )
}

export function footer(): HTMLElement {
  return el(
    'footer',
    { class: 'site-footer' },
    el(
      'div',
      { class: 'bar' },
      el(
        'span',
        {},
        'mindpeeker-sdk — rigorous randomness × frontier research. Every demo runs client-side. MIT.',
      ),
      el('a', { href: REPO_URL, target: '_blank', rel: 'noreferrer' }, 'GitHub ↗'),
    ),
  )
}

export function pageHead(eyebrow: string, title: string, intro: string): HTMLElement {
  return el(
    'div',
    { class: 'page-head' },
    el('div', { class: 'eyebrow' }, eyebrow),
    el('h1', {}, title),
    el('p', {}, intro),
  )
}

/** Inject header + page head + footer; return the content container to fill. */
export function shell(opts: {
  active: string
  eyebrow: string
  title: string
  intro: string
}): HTMLElement {
  document.title = `${opts.title} · mindpeeker-sdk`
  const content = el('div', {})
  document.body.append(
    header(opts.active),
    el(
      'main',
      {},
      el('div', { class: 'wrap' }, pageHead(opts.eyebrow, opts.title, opts.intro), content),
    ),
    footer(),
  )
  return content
}
