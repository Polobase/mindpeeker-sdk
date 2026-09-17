/** Render any thrown value as text without ever throwing itself. */
function textOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return String(value)
  } catch {
    return typeof value
  }
}

/**
 * One-line reason for a failure: the error's message followed by the messages
 * of its `cause` chain (up to five levels, skipping a message already contained
 * in an outer one), joined with `': '` and truncated to `maxLength` characters.
 * E.g. `esp32 stream failed: opening /dev/ttyUSB0 failed: ENOENT … — no such device`.
 */
export function describeError(error: unknown, maxLength = 300): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    const message = textOf(current).trim()
    if (message.length > 0 && !parts.some((part) => part.includes(message))) parts.push(message)
    current = current instanceof Error ? current.cause : undefined
  }
  const text = parts.length > 0 ? parts.join(': ') : 'unknown error'
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text
}
