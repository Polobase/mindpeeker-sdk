import type { Ref, ShallowRef } from 'vue'
import { isAbortError } from '~/lib/errors'

export interface TaskContext {
  /** Aborted by `cancel()`, by the next `run()`, and on unmount. */
  readonly signal: AbortSignal
  /** Report progress in [0, 1]; pass `null` for "indeterminate". */
  setProgress: (value: number | null) => void
}

export interface Task<T> {
  /** True while a run is in flight. */
  readonly busy: Ref<boolean>
  /** Last reported progress in [0, 1], or null when unknown. */
  readonly progress: Ref<number | null>
  /** The last failure (cancellation is not a failure). */
  readonly error: Ref<unknown>
  /** The last successful result. */
  readonly result: ShallowRef<T | undefined>
  /** Run `fn`, cancelling any run still in flight. Resolves undefined on error/cancel. */
  run: (fn: (signal: AbortSignal, setProgress: TaskContext['setProgress']) => Promise<T>) => Promise<T | undefined>
  /** Abort the current run. */
  cancel: () => void
  /** Clear error, result and progress (keeps a running task alone). */
  reset: () => void
}

/**
 * One async run with busy state, progress, typed errors and cancellation —
 * aborted automatically when the component unmounts.
 *
 * ```ts
 * const task = useTask<ScanReport>()
 * const go = () => task.run(async (signal, setProgress) => {
 *   setProgress(0)
 *   return await scan(catalog, provider, { signal })
 * })
 * ```
 * ```vue
 * <RunControls :busy="task.busy.value" :progress="task.progress.value"
 *   @run="go" @cancel="task.cancel" />
 * <ErrorAlert :err="task.error.value" />
 * ```
 */
export function useTask<T = unknown>(): Task<T> {
  const busy = ref(false)
  const progress = ref<number | null>(null)
  const error = ref<unknown>(undefined)
  const result = shallowRef<T | undefined>(undefined)

  let controller: AbortController | undefined

  function cancel(): void {
    controller?.abort()
    controller = undefined
    busy.value = false
    progress.value = null
  }

  function reset(): void {
    error.value = undefined
    result.value = undefined
    progress.value = null
  }

  async function run(
    fn: (signal: AbortSignal, setProgress: TaskContext['setProgress']) => Promise<T>,
  ): Promise<T | undefined> {
    controller?.abort()
    const current = new AbortController()
    controller = current
    busy.value = true
    progress.value = null
    error.value = undefined
    const setProgress = (value: number | null) => {
      if (controller !== current) return
      progress.value = value === null ? null : Math.min(1, Math.max(0, value))
    }
    try {
      const value = await fn(current.signal, setProgress)
      if (current.signal.aborted) return undefined
      result.value = value
      return value
    } catch (err) {
      // A cancelled run is not a failure: leave the last result in place.
      if (!current.signal.aborted && !isAbortError(err)) error.value = err
      return undefined
    } finally {
      if (controller === current) {
        controller = undefined
        busy.value = false
        progress.value = null
      }
    }
  }

  onScopeDispose(() => {
    controller?.abort()
    controller = undefined
  })

  return { busy, progress, error, result, run, cancel, reset }
}
