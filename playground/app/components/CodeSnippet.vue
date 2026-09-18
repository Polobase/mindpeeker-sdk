<script setup lang="ts">
/**
 * The SDK call behind what the demo just did, with a copy button. SSR-safe
 * (the clipboard is touched only inside the click handler).
 *
 * ```vue
 * <CodeSnippet :code="`const cast = await castHexagram(reader)`" lang="ts" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    code: string
    /** Shown as the chip in the header (default 'ts'). */
    lang?: string
    /** Optional caption above the code. */
    title?: string
  }>(),
  { lang: 'ts', title: undefined },
)

/**
 * Every right-to-left script the SDK's ciphers touch: Hebrew, Arabic (+ its
 * supplement and extensions), Syriac, Thaana, NKo, Samaritan, Mandaic, and the
 * Hebrew/Arabic presentation forms.
 */
const RTL_RUN = /[֐-ࣿיִ-﷿ﹰ-﻿]+/g

/**
 * A Hebrew or Arabic literal inside LTR code absorbs the neutral characters
 * that follow it, so `temurahShift("אמת", 1)` *paints* as `temurahShift("1 ,"אמת)`
 * even though the text is correct. Isolating each RTL run (U+2067 … U+2069)
 * makes the bidi algorithm treat it as one opaque unit, so the quotes, commas
 * and parentheses around it stay in code order.
 *
 * Only the rendering is isolated: `copy()` writes the untouched `props.code`.
 */
function isolateRtl(code: string): string {
  return code.replace(RTL_RUN, (run) => `⁧${run}⁩`)
}

const display = computed(() => isolateRtl(props.code))

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="rounded-md border border-default bg-elevated/50 overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-default">
      <span class="text-[11px] uppercase tracking-wide text-dimmed">{{ lang }}</span>
      <span v-if="title" class="text-xs text-muted truncate">{{ title }}</span>
      <UButton
        class="ms-auto"
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        :aria-label="copied ? 'Copied' : 'Copy code'"
        @click="copy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </UButton>
    </div>
    <pre
      dir="ltr"
      class="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed font-mono text-highlighted"
    ><code>{{ display }}</code></pre>
  </div>
</template>
