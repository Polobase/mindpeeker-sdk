/**
 * Arabic Abjad — *Ḥisāb al-Jummal*, the numeral use of the Arabic alphabet.
 * This is the Eastern / Mashriqi order (the order used across the Arab East and
 * in most magical/occult sources), whose 28 letters fill the ones, tens,
 * hundreds and a final thousand:
 *
 * $$\text{ا}1\,\text{ب}2\,\text{ج}3\,\text{د}4\,\text{ه}5\,\text{و}6\,\text{ز}7\,
 * \text{ح}8\,\text{ط}9\;\text{ي}10\,\text{ك}20\,\text{ل}30\,\text{م}40\,\text{ن}50\,
 * \text{س}60\,\text{ع}70\,\text{ف}80\,\text{ص}90\;\text{ق}100\,\text{ر}200\,
 * \text{ش}300\,\text{ت}400\,\text{ث}500\,\text{خ}600\,\text{ذ}700\,\text{ض}800\,
 * \text{ظ}900\,\text{غ}1000.$$
 *
 * **Conventions** (applied by {@link normalizeFor} and by this cipher's `fold`):
 * a hamza on a seat counts as its seat letter (أ إ آ → ا = 1, ؤ → و = 6,
 * ئ → ي = 10); alef wasla ٱ → ا; tāʾ marbūṭa ة counts as hāʾ ه (5); alef maqsūra
 * ى counts as yāʾ ي (10); the Persian/Urdu code points keheh ک and farsi yeh ی
 * count as ك (20) and ي (10). The free-standing hamza ء, the harakāt, tanwīn,
 * dagger alef and tatwīl carry no value. The Persian-only letters پ چ ژ گ are
 * not folded and score 0. Summing is order-independent, so right-to-left needs
 * no special handling. The Western/Maghribi order is not shipped (no verified
 * table). This is `modern: false`: the Abjad numerals are the historical
 * pre-Hindu-Arabic number system of the script.
 *
 * Sources: Freedman's comparative Greek/Hebrew/Arabic numeral table (the 28
 * letters in numerical order, ghayn = 1000); standard *Ḥisāb al-Jummal* Abjad
 * tables (Mashriqi order).
 */

import { ARABIC_LETTER_FOLDS } from '../normalize.js'
import type { Cipher } from '../types.js'
import { defineCipher, glyphs, numeralLadder } from './define.js'

/** The 28 letters in Mashriqi (Eastern) Abjad order. */
const ABJAD = glyphs('ا ب ج د ه و ز ح ط ي ك ل م ن س ع ف ص ق ر ش ت ث خ ذ ض ظ غ')

/** The single Arabic cipher (Abjad, Mashriqi order). */
export const ARABIC_CIPHERS: readonly Cipher[] = Object.freeze([
  defineCipher({
    id: 'ar-abjad',
    label: 'Abjad (Mashriqi)',
    description:
      'Arabic Abjad (Ḥisāb al-Jummal), Mashriqi order: ا1…ط9, ي10…ص90, ق100…ظ900, غ1000; hamza ' +
      'counts as its seat, ة as ه, ى as ي.',
    script: 'arabic',
    modern: false,
    alphabet: ABJAD,
    variants: ARABIC_LETTER_FOLDS,
    value: (letter) => numeralLadder(ABJAD.indexOf(letter)),
  }),
])
