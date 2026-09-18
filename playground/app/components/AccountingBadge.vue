<script setup lang="ts">
import { fmtBytes, fmtNum } from '~/lib/format'

/**
 * The entropy receipt every oracle/field/scan result carries. SSR-safe.
 *
 * ```vue
 * <AccountingBadge :bytes-consumed="cast.bytesConsumed"
 *   :bytes-fetched="cast.bytesFetched" :bits-used="cast.bitsUsed"
 *   :source="report.source" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    bytesConsumed?: number
    bytesFetched?: number
    bitsUsed?: number
    /** Source name to show alongside, e.g. `hmac-drbg(seed:1f2e3d4c)`. */
    source?: string
  }>(),
  { bytesConsumed: undefined, bytesFetched: undefined, bitsUsed: undefined, source: undefined },
)

const parts = computed(() => {
  const out: { key: string; text: string; title: string }[] = []
  if (props.bytesConsumed !== undefined) {
    out.push({
      key: 'consumed',
      text: `${fmtBytes(props.bytesConsumed)} consumed`,
      title:
        'Bytes read from the reader, including bytes discarded by rejection sampling — this is what a replay needs.',
    })
  }
  if (props.bytesFetched !== undefined) {
    out.push({
      key: 'fetched',
      text: `${fmtBytes(props.bytesFetched)} fetched`,
      title: 'Bytes the reader pulled out of the underlying source (chunked reads round up).',
    })
  }
  if (props.bitsUsed !== undefined) {
    out.push({
      key: 'bits',
      text: `${fmtNum(props.bitsUsed)} bits used`,
      title: 'Bits that actually reached the result after rejection sampling.',
    })
  }
  return out
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 text-xs">
    <UBadge
      v-for="part in parts"
      :key="part.key"
      color="neutral"
      variant="subtle"
      class="font-mono"
      :title="part.title"
    >
      {{ part.text }}
    </UBadge>
    <UBadge v-if="source" color="neutral" variant="outline" class="font-mono" title="Source that served the bytes">
      {{ source }}
    </UBadge>
  </div>
</template>
