// Shared calculator state for the gematria page: the word, the focus cipher
// and its options, so the calculator, the profile table and the Hebrew tools
// all talk about the same text without prop plumbing.
//
// Type-only SDK imports (erased at build time), but this module is only ever
// imported from `*.client.vue` components.

import type { CipherId, NamesVariant, Script } from '@mindpeeker/gematria'
import { reactive } from 'vue'

export interface CalcState {
  /** The word or phrase being valued. */
  text: string
  /** The focus cipher — always one of the detected script's ciphers. */
  cipher: CipherId
  /** Score the cipher's mirror over its canonical alphabet. */
  reverse: boolean
  /** `en-reduction` only: Hubbard's S = 10 rule (H under reverse). */
  keepTen: boolean
  /** `he-milui` / `he-neelam` only: the letter-name spelling convention. */
  namesVariant: NamesVariant
  /** Profile rows: the modern calculator ciphers. */
  includeModern: boolean
  /** Profile rows: the SDK-added extended methods. */
  includeExtended: boolean
  /** `'auto'` detects the script from the text. */
  forcedScript: 'auto' | Script
}

export const calc = reactive<CalcState>({
  text: 'gematria',
  cipher: 'en-ordinal',
  reverse: false,
  keepTen: false,
  namesVariant: 'standard',
  includeModern: true,
  includeExtended: true,
  forcedScript: 'auto',
})

/** Hebrew-only tools keep their own word, so the calculator can hold any script. */
export const hebrew = reactive({
  text: 'אמת',
  /** Aiq Beker / notariqon second operand. */
  other: 'אדם',
  phrase: 'אתה גבור לעולם אדני',
  numeral: 5784,
})

/** The number the Numbers tab portrays (seeded from a value elsewhere). */
export const numberState = reactive({ n: 666 })

/** Send a value to the Numbers tab without navigating for the user. */
export function inspectNumber(n: number): void {
  numberState.n = n
}
