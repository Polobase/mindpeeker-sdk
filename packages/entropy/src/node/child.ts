import type { ChildProcess } from 'node:child_process'

/** Characters of child stderr kept for error messages (the tail — where the fatal line is). */
export const STDERR_TAIL_CHARS = 4096

/**
 * Collect a child's stderr, keeping only the last `limit` characters so a
 * chatty or looping process cannot grow memory without bound.
 */
export function stderrTail(child: ChildProcess, limit = STDERR_TAIL_CHARS): () => string {
  let text = ''
  child.stderr?.on('data', (data: Buffer) => {
    text += data.toString()
    if (text.length > limit) text = text.slice(-limit)
  })
  return () => text.trim()
}

/**
 * SIGKILL the child the moment `signal` aborts (immediately when it already
 * has). Returns the unsubscribe function — call it in `finally`.
 */
export function killOnAbort(child: ChildProcess, signal?: AbortSignal): () => void {
  if (!signal) return () => {}
  const onAbort = () => {
    child.kill('SIGKILL')
  }
  if (signal.aborted) {
    onAbort()
    return () => {}
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}
