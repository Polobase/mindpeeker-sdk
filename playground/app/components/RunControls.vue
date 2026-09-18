<script setup lang="ts">
/**
 * Run / Cancel with busy state and a progress bar. SSR-safe.
 *
 * ```vue
 * <RunControls :busy="task.busy.value" :progress="task.progress.value"
 *   label="Run 100 trials" @run="start" @cancel="task.cancel()">
 *   <UButton variant="soft" color="neutral" :disabled="task.busy.value" @click="reset">Reset</UButton>
 * </RunControls>
 * ```
 * `:on-run`/`:on-cancel` props work the same as the listeners.
 */
withDefaults(
  defineProps<{
    busy: boolean
    /** 0..1, or null/undefined for an indeterminate run. */
    progress?: number | null
    label?: string
    /** Label while busy (default 'Running…'). */
    busyLabel?: string
    /** Disable the run button (e.g. invalid input). */
    disabled?: boolean
    /** Offer Cancel while busy (default true). */
    cancellable?: boolean
    icon?: string
    /** Extra line under the buttons, e.g. "≈ 1.5 kB from drand". */
    hint?: string
  }>(),
  {
    progress: null,
    label: 'Run',
    busyLabel: 'Running…',
    disabled: false,
    cancellable: true,
    icon: 'i-lucide-play',
    hint: undefined,
  },
)

const emit = defineEmits<{ run: []; cancel: [] }>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <UButton :icon="icon" :loading="busy" :disabled="disabled || busy" @click="emit('run')">
        {{ busy ? busyLabel : label }}
      </UButton>
      <UButton
        v-if="cancellable && busy"
        color="neutral"
        variant="soft"
        icon="i-lucide-square"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <slot />
    </div>
    <div v-if="busy" class="flex items-center gap-2">
      <UProgress
        :model-value="progress === null || progress === undefined ? null : Math.round(progress * 100)"
        :max="100"
        size="sm"
        class="max-w-xs"
      />
      <span class="text-xs text-muted tabular-nums" role="status" aria-live="polite">
        {{ progress === null || progress === undefined ? 'working…' : `${Math.round(progress * 100)}%` }}
      </span>
    </div>
    <p v-if="hint" class="text-xs text-muted">{{ hint }}</p>
  </div>
</template>
