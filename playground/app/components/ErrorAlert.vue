<script setup lang="ts">
import { errorInfo, type ErrorInfo } from '~/lib/errors'

/**
 * A typed SDK failure, displayed instead of thrown. SSR-safe.
 * Renders nothing when `err` is null/undefined.
 *
 * The heading is always `Name (code)` — `EntropyError (timeout)`,
 * `RateError (invalid_rate)` — because that pair is the thing the pages promise
 * to show and the thing a reader can look up. A `title` is the human sentence
 * that goes *with* it, not instead of it.
 *
 * ```vue
 * <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
 * <ErrorAlert :err="parseError" title="This rate does not parse" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    err?: unknown
    /** A human sentence shown above the message; the heading stays `Name (code)`. */
    title?: string
    /** Show a close button that emits `dismiss` (default true). */
    dismissible?: boolean
  }>(),
  { err: undefined, title: undefined, dismissible: true },
)

const emit = defineEmits<{ dismiss: [] }>()

/**
 * `errorInfo` renders a cause as `Name: message`. When the error's own message
 * already contains that sentence, repeating it in full adds nothing — keep the
 * cause's class, which is the part the message does not carry.
 */
function causeFragment(value: ErrorInfo): string {
  const cause = value.cause
  if (!cause) return ''
  const split = cause.indexOf(': ')
  const body = split >= 0 ? cause.slice(split + 2) : cause
  if (body && value.message.includes(body)) {
    return split > 0 ? `cause: ${cause.slice(0, split)}` : ''
  }
  return `cause: ${cause}`
}

const info = computed(() => (props.err === undefined || props.err === null ? undefined : errorInfo(props.err)))
const heading = computed(() => {
  const value = info.value
  if (!value) return ''
  return `${value.name}${value.code ? ` (${value.code})` : ''}`
})
const detail = computed(() => {
  const value = info.value
  if (!value) return ''
  const extra = [value.provider ? `provider: ${value.provider}` : '', causeFragment(value)]
    .filter(Boolean)
    .join(' · ')
  const body = extra ? `${value.message} — ${extra}` : value.message
  const lead = props.title && props.title !== value.message ? `${props.title} — ` : ''
  return `${lead}${body}`
})
</script>

<template>
  <!--
    `role="alert"` so a failure that appears after a click — a typed SDK error,
    a refused configuration — is announced instead of only drawn. The element is
    inserted with its text already in place, which is exactly the case `alert`
    is specified for.
  -->
  <UAlert
    v-if="info"
    role="alert"
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="heading"
    :description="detail"
    :close="dismissible"
    :ui="{ description: 'break-words' }"
    @update:open="emit('dismiss')"
  />
</template>
