// Tiny DOM helpers shared by every page. No framework — hand-rolled elements.

type Child = Node | string | null | undefined | false
type Props = Record<string, unknown>

/** Create an element: `el('button', { class: 'primary', onclick: fn }, 'Go')`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'html') node.innerHTML = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value as Record<string, string>)
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else node.setAttribute(key, String(value))
  }
  append(node, children)
  return node
}

/** Append a flat or nested list of children, skipping nullish/false entries. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}

/** Replace all children of `parent` with `children`. */
export function replace(parent: Node, ...children: Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild)
  append(parent, children)
}

/** Format a number with a fixed number of significant-ish decimals, trimmed. */
export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toFixed(digits)
}

/** First `n` bytes as a lowercase hex string. */
export function hex(bytes: Uint8Array, n = bytes.length): string {
  let out = ''
  for (let i = 0; i < Math.min(n, bytes.length); i++) {
    out += (bytes[i] as number).toString(16).padStart(2, '0')
  }
  return out
}
