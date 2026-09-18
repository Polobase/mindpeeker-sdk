import type { WritableComputedRef } from 'vue'

export interface TabQueryOptions {
  /** Query parameter to sync with (default 'tab'). */
  key?: string
  /** Allowed values; anything else in the URL falls back to the default. */
  tabs?: readonly string[]
}

/**
 * A `v-model` for `UTabs` that lives in the URL (`?tab=…`), so a tab is
 * linkable and survives reload and back/forward. The default tab keeps the URL
 * clean (no query parameter).
 *
 * ```ts
 * const tab = useTabQuery('overview', { tabs: ['overview', 'details'] })
 * ```
 * ```vue
 * <UTabs v-model="tab" :items="items" />
 * ```
 */
export function useTabQuery(
  defaultTab: string,
  options: TabQueryOptions = {},
): WritableComputedRef<string> {
  const { key = 'tab', tabs } = options
  const route = useRoute()
  const router = useRouter()

  const allowed = (value: unknown): value is string =>
    typeof value === 'string' && (!tabs || tabs.includes(value))

  return computed<string>({
    get() {
      const raw = route.query[key]
      const value = Array.isArray(raw) ? raw[0] : raw
      return allowed(value) ? value : defaultTab
    },
    set(value: string) {
      const query = { ...route.query }
      if (value === defaultTab) delete query[key]
      else query[key] = value
      // replace(): switching a tab is not a navigation step.
      void router.replace({ query, hash: route.hash })
    },
  })
}
