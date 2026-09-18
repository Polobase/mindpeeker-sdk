<script setup lang="ts">
/**
 * §4 — C2SP signed notes and tlog checkpoints: generate an Ed25519 key pair
 * with crypto.subtle, sign a checkpoint over the log's Merkle head, then parse
 * and verify it — including the cases that must not verify.
 */
import {
  type CheckpointVerification,
  ED25519_TYPE,
  ed25519VerifierKey,
  checkpointOf,
  checkpointText,
  noteKeyId,
  type NoteSignature,
  parseCheckpoint,
  serializeCheckpoint,
  signNote,
  toHex,
  verifyCheckpoint,
} from '@mindpeeker/ledger'
import { defaultLeaves } from '~/lib/ledger/merkle'

const ORIGIN = 'example.org/mindpeeker-playground/session-log'
const NAME = 'playground-log'

const size = ref(24)
const leaves = computed(() => defaultLeaves(size.value))

type Fault =
  | 'none'
  | 'edit-size'
  | 'wrong-origin'
  | 'unknown-key'
  | 'other-key-type'
  | 'unsigned'
  | 'not-a-note'

const FAULTS: { label: string; value: Fault; expect: string }[] = [
  { label: 'none — the checkpoint as signed', value: 'none', expect: "status 'verified'" },
  {
    label: 'edit the tree size in the signed text',
    value: 'edit-size',
    expect: "status 'failed' — the signature covers the whole note text",
  },
  {
    label: 'expect a different origin',
    value: 'wrong-origin',
    expect: "status 'failed' — the origin line is not the log you asked for",
  },
  {
    label: 'verify against someone else’s key',
    value: 'unknown-key',
    expect: "status 'unverified' — unknown signatures are ignored, and none remain",
  },
  {
    label: 'known key, but not an Ed25519 key type',
    value: 'other-key-type',
    expect: "status 'unverified', the signature listed under unsupported — never a false verified",
  },
  {
    label: 'publish the bare body with no signature',
    value: 'unsigned',
    expect: "status 'unverified' — it parses, nobody vouched for it",
  },
  {
    label: 'hand it text that is not a note at all',
    value: 'not-a-note',
    expect: "status 'failed' with a reason — reported, not thrown",
  },
]

const fault = ref<Fault>('none')

interface Signed {
  readonly origin: string
  readonly size: number
  readonly rootHex: string
  readonly text: string
  readonly note: string
  readonly vkey: string
  readonly otherVkey: string
  readonly typedVkey: string
  readonly keyId: number
  readonly signature: NoteSignature
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const task = useTask<Signed>()
const signed = computed(() => task.result.value)

function run(): void {
  void task.run(async (_signal, setProgress) => {
    setProgress(0.1)
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    setProgress(0.4)
    const checkpoint = await checkpointOf(ORIGIN, leaves.value)
    const text = checkpointText(checkpoint)
    const signature = await signNote(text, { name: NAME, privateKey: pair.privateKey, publicKey })
    setProgress(0.7)
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const otherPublic = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey))
    const keyId = await noteKeyId(NAME, ED25519_TYPE, publicKey)
    setProgress(1)
    return {
      origin: checkpoint.origin,
      size: checkpoint.size,
      rootHex: toHex(checkpoint.root),
      text,
      note: serializeCheckpoint(checkpoint, [signature]),
      vkey: await ed25519VerifierKey(NAME, publicKey),
      otherVkey: await ed25519VerifierKey('someone-else', otherPublic),
      // Same name and key ID, signature type 0x02: known to the verifier,
      // impossible for it to check. parseVerifierKey only enforces the key-ID
      // derivation for Ed25519.
      typedVkey: `${NAME}+${keyId.toString(16).padStart(8, '0')}+${base64(
        new Uint8Array([0x02, ...publicKey]),
      )}`,
      keyId,
      signature,
    }
  })
}

const presented = computed(() => {
  const current = signed.value
  if (!current) return { text: '', keys: [] as string[], origin: ORIGIN as string | undefined }
  switch (fault.value) {
    case 'edit-size':
      return {
        text: current.note.replace(`\n${current.size}\n`, `\n${current.size + 1}\n`),
        keys: [current.vkey],
        origin: ORIGIN,
      }
    case 'wrong-origin':
      return { text: current.note, keys: [current.vkey], origin: 'example.org/a-different-log' }
    case 'unknown-key':
      return { text: current.note, keys: [current.otherVkey], origin: ORIGIN }
    case 'other-key-type':
      return { text: current.note, keys: [current.typedVkey], origin: ORIGIN }
    case 'unsigned':
      return { text: current.text, keys: [current.vkey], origin: ORIGIN }
    case 'not-a-note':
      return { text: 'just some text a server returned\n', keys: [current.vkey], origin: ORIGIN }
    default:
      return { text: current.note, keys: [current.vkey], origin: ORIGIN }
  }
})

const result = shallowRef<CheckpointVerification>()
const verifyError = ref<unknown>()

let seq = 0
watch(
  presented,
  () => {
    const mine = ++seq
    void (async () => {
      const { text, keys, origin } = presented.value
      if (text === '') {
        result.value = undefined
        return
      }
      try {
        const outcome = await verifyCheckpoint(text, keys, origin ? { origin } : {})
        if (mine !== seq) return
        result.value = outcome
        verifyError.value = undefined
      } catch (error) {
        if (mine !== seq) return
        verifyError.value = error
        result.value = undefined
      }
    })()
  },
  { immediate: true },
)

/** The parsed body, read back from the text a reader would receive. */
const parsed = computed(() => {
  const text = presented.value.text
  if (text === '') return undefined
  try {
    return parseCheckpoint(text)
  } catch {
    return undefined
  }
})

const expectation = computed(() => FAULTS.find((f) => f.value === fault.value)?.expect ?? '')

const statusColor = computed(() =>
  result.value?.status === 'verified'
    ? 'success'
    : result.value?.status === 'failed'
      ? 'error'
      : 'warning',
)

const snippet = computed(
  () => `import { checkpointOf, checkpointText, ed25519VerifierKey, serializeCheckpoint, signNote, verifyCheckpoint } from '@mindpeeker/ledger'

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))

const checkpoint = await checkpointOf('${ORIGIN}', lines)   // { origin, size: ${
    signed.value?.size ?? size.value
  }, root }
const signature = await signNote(checkpointText(checkpoint), { name: '${NAME}', privateKey: pair.privateKey, publicKey })
const published = serializeCheckpoint(checkpoint, [signature])

const vkey = await ed25519VerifierKey('${NAME}', publicKey)  // <name>+<hex id>+base64(type ‖ key)
await verifyCheckpoint(published, [vkey], { origin: '${ORIGIN}' })
// → { status: '${result.value?.status ?? '…'}', verified: ${result.value?.verified.length ?? 0}, failed: ${
    result.value?.failed.length ?? 0
  }, unknown: ${result.value?.unknown.length ?? 0}, unsupported: ${result.value?.unsupported.length ?? 0} }`,
)
</script>

<template>
  <DemoSection
    id="checkpoint"
    title="A tree head with an author"
    description="A C2SP tlog checkpoint is three lines of text — origin, decimal tree size, base64 root — signed as a C2SP signed note. That is what turns (size, root) from something a proof supplier asserts into something a named key vouched for. The key pair below is generated in your browser and never stored, so the signature differs on every run while the outcome does not."
    :api="['checkpointOf', 'checkpointText', 'signNote', 'serializeCheckpoint', 'parseCheckpoint', 'verifyCheckpoint', 'ed25519VerifierKey', 'noteKeyId']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Generate a key and sign"
        icon="i-lucide-signature"
        hint="Ed25519 via crypto.subtle — the browser must support it"
        @run="run"
        @cancel="task.cancel()"
      />
      <UFormField label="Log size" size="sm" class="w-28">
        <UInputNumber v-model="size" :min="1" :max="2000" :step="8" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="What the reader receives" size="sm" class="w-full sm:w-80">
        <USelect
          v-model="fault"
          :items="FAULTS.map((f) => ({ label: f.label, value: f.value }))"
          size="sm"
          class="w-full"
          :disabled="!signed"
        />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
    <ErrorAlert :err="verifyError" title="Verification refused the input" :dismissible="false" />

    <p v-if="!signed" class="text-sm text-muted">
      Press <strong class="text-highlighted">Generate a key and sign</strong>. If your browser's
      WebCrypto has no Ed25519, the package throws
      <code>LedgerError('crypto_unavailable')</code> rather than pretending — that error will appear
      above.
    </p>

    <div v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge size="sm" :color="statusColor" variant="subtle" class="font-mono">
          status: {{ result?.status ?? '…' }}
        </UBadge>
        <UBadge size="sm" color="neutral" variant="subtle">
          verified {{ result?.verified.length ?? 0 }} · failed {{ result?.failed.length ?? 0 }} ·
          unknown {{ result?.unknown.length ?? 0 }} · unsupported
          {{ result?.unsupported.length ?? 0 }}
        </UBadge>
        <UBadge v-if="parsed" size="sm" color="neutral" variant="subtle" class="font-mono">
          parsed size {{ parsed.size }}
        </UBadge>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">expected outcome</div>
          <div class="text-sm text-highlighted">{{ expectation }}</div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">reason from verifyCheckpoint</div>
          <div class="text-sm text-highlighted">{{ result?.reason ?? 'none — it verified' }}</div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2 min-w-0">
          <div class="text-[11px] uppercase tracking-wide text-muted">
            the signed note, exactly as published
          </div>
          <pre
            class="rounded-md border border-default bg-elevated/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
          >{{ presented.text }}</pre>
        </div>
        <div class="flex flex-col gap-2 min-w-0">
          <StatTile label="Merkle root the note commits to" size="sm">
            <template #value>
              <span class="block text-[11px] break-all">{{ signed.rootHex }}</span>
            </template>
            <template #note>{{ signed.size }} leaves · origin {{ signed.origin }}</template>
          </StatTile>
          <StatTile label="Verifier key" size="sm">
            <template #value>
              <span class="block text-[11px] break-all">{{ presented.keys[0] }}</span>
            </template>
            <template #note>
              key ID {{ signed.keyId }} = first 4 bytes of SHA-256(name ‖ 0x0A ‖ type ‖ key)
            </template>
          </StatTile>
          <p class="text-xs text-muted">
            Verification follows the spec: signatures from unknown keys are ignored, every signature
            from a known key must verify, and at least one must. A runtime without Ed25519 yields
            <code>unverified</code> with the signature under <code>unsupported</code> — never a
            false <code>verified</code>.
          </p>
        </div>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="A signature is not honesty">
        A verified checkpoint proves that the key holder signed this (origin, size, root). It does
        not prove the key holder is honest, or that they did not sign a second, diverging tree for
        someone else. That is what witnesses are for: collect checkpoints over time and run
        <code>verifyConsistency</code> between them — a signer who forks the log cannot make both
        branches consistent.
      </HonestNote>
    </template>
  </DemoSection>
</template>
