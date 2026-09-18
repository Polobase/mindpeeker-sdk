import type { Ref } from 'vue'

/**
 * Run `fn` as soon as a template ref points at a real element, and again if it
 * is replaced; the function may return a cleanup that runs before the next call
 * and on unmount.
 *
 * Why this exists: a `*.client.vue` component renders a placeholder during
 * hydration (Nuxt's `createClientOnly`), so its own template refs are still
 * `undefined` inside `onMounted` on a fresh page load. Anything that needs the
 * DOM — a canvas context, a measurement, a third-party mount — goes here
 * instead of in `onMounted`.
 *
 * ```ts
 * const canvasEl = ref<HTMLCanvasElement>()
 * useElementReady(canvasEl, (canvas) => {
 *   const ctx = canvas.getContext('2d')
 *   const id = setInterval(() => draw(ctx), 100)
 *   return () => clearInterval(id)
 * })
 * ```
 */
export function useElementReady<T extends Element>(
  el: Ref<T | undefined | null>,
  fn: (element: T) => void | (() => void),
): void {
  let cleanup: (() => void) | undefined
  const stop = watch(
    el,
    (element) => {
      cleanup?.()
      cleanup = undefined
      if (!element) return
      const result = fn(element)
      if (typeof result === 'function') cleanup = result
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => {
    stop()
    cleanup?.()
    cleanup = undefined
  })
}
