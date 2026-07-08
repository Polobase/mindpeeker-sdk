/**
 * The eight trigrams and sixty-four hexagrams of the I-Ching (Yijing), King
 * Wen sequence. Line/bit conventions match the rest of the SDK and the
 * classical texts: lines are written **bottom → top**, yang $= 1$,
 * yin $= 0$; the lower trigram is lines 1–3, the upper trigram lines 4–6.
 *
 * English hexagram titles follow the Wilhelm–Baynes translation
 * (Wilhelm & Baynes, *The I Ching or Book of Changes*, 1950); glyphs are
 * the Unicode Yijing Hexagram Symbols block (U+4DC0–U+4DFF, ordered by King
 * Wen number) and Miscellaneous Symbols trigrams (U+2630–U+2637).
 */

/** One of the eight trigrams (ba gua). `bits` is bottom → top, yang = 1. */
export interface Trigram {
  readonly key: TrigramKey
  /** Unicode trigram glyph, e.g. ☰. */
  readonly character: string
  /** Traditional image name, e.g. 'Heaven'. */
  readonly name: string
  /** Three line bits, bottom → top ('111' = Qian). */
  readonly bits: string
}

export type TrigramKey = 'Qian' | 'Dui' | 'Li' | 'Zhen' | 'Xun' | 'Kan' | 'Gen' | 'Kun'

const trigram = (key: TrigramKey, character: string, name: string, bits: string): Trigram =>
  Object.freeze({ key, character, name, bits })

/** The eight trigrams, keyed by pinyin name. */
export const TRIGRAMS: Readonly<Record<TrigramKey, Trigram>> = Object.freeze({
  Qian: trigram('Qian', '☰', 'Heaven', '111'),
  Dui: trigram('Dui', '☱', 'Lake', '110'),
  Li: trigram('Li', '☲', 'Fire', '101'),
  Zhen: trigram('Zhen', '☳', 'Thunder', '100'),
  Xun: trigram('Xun', '☴', 'Wind', '011'),
  Kan: trigram('Kan', '☵', 'Water', '010'),
  Gen: trigram('Gen', '☶', 'Mountain', '001'),
  Kun: trigram('Kun', '☷', 'Earth', '000'),
})

/** One hexagram of the King Wen sequence. */
export interface Hexagram {
  /** King Wen number, 1–64. */
  readonly kingWen: number
  /** Unicode hexagram glyph from U+4DC0–U+4DFF, e.g. ䷀ for #1. */
  readonly character: string
  readonly name: {
    /** Chinese title, e.g. 乾. */
    readonly zh: string
    /** Pinyin romanization, e.g. Qián. */
    readonly pinyin: string
    /** English translation (Wilhelm–Baynes), e.g. 'The Creative'. */
    readonly en: string
  }
  /** Six line bits bottom → top, yang = 1 (e.g. '111111' for #1). */
  readonly binary: string
  /** Lines 1–3. */
  readonly lower: Trigram
  /** Lines 4–6. */
  readonly upper: Trigram
}

// [King Wen number, zh, pinyin, en, lower trigram, upper trigram]
const ROWS: readonly (readonly [number, string, string, string, TrigramKey, TrigramKey])[] = [
  [1, '乾', 'Qián', 'The Creative', 'Qian', 'Qian'],
  [2, '坤', 'Kūn', 'The Receptive', 'Kun', 'Kun'],
  [3, '屯', 'Zhūn', 'Difficulty at the Beginning', 'Zhen', 'Kan'],
  [4, '蒙', 'Méng', 'Youthful Folly', 'Kan', 'Gen'],
  [5, '需', 'Xū', 'Waiting', 'Qian', 'Kan'],
  [6, '訟', 'Sòng', 'Conflict', 'Kan', 'Qian'],
  [7, '師', 'Shī', 'The Army', 'Kan', 'Kun'],
  [8, '比', 'Bǐ', 'Holding Together', 'Kun', 'Kan'],
  [9, '小畜', 'Xiǎo Chù', 'Taming Power of the Small', 'Qian', 'Xun'],
  [10, '履', 'Lǚ', 'Treading', 'Dui', 'Qian'],
  [11, '泰', 'Tài', 'Peace', 'Qian', 'Kun'],
  [12, '否', 'Pǐ', 'Standstill', 'Kun', 'Qian'],
  [13, '同人', 'Tóng Rén', 'Fellowship with Others', 'Li', 'Qian'],
  [14, '大有', 'Dà Yǒu', 'Possession in Great Measure', 'Qian', 'Li'],
  [15, '謙', 'Qiān', 'Modesty', 'Gen', 'Kun'],
  [16, '豫', 'Yù', 'Enthusiasm', 'Kun', 'Zhen'],
  [17, '隨', 'Suí', 'Following', 'Zhen', 'Dui'],
  [18, '蠱', 'Gǔ', 'Work on the Decayed', 'Xun', 'Gen'],
  [19, '臨', 'Lín', 'Approach', 'Dui', 'Kun'],
  [20, '觀', 'Guān', 'Contemplation', 'Kun', 'Xun'],
  [21, '噬嗑', 'Shì Kè', 'Biting Through', 'Zhen', 'Li'],
  [22, '賁', 'Bì', 'Grace', 'Li', 'Gen'],
  [23, '剝', 'Bō', 'Splitting Apart', 'Kun', 'Gen'],
  [24, '復', 'Fù', 'Return', 'Zhen', 'Kun'],
  [25, '無妄', 'Wú Wàng', 'Innocence', 'Zhen', 'Qian'],
  [26, '大畜', 'Dà Chù', 'Taming Power of the Great', 'Qian', 'Gen'],
  [27, '頤', 'Yí', 'The Corners of the Mouth', 'Zhen', 'Gen'],
  [28, '大過', 'Dà Guò', 'Preponderance of the Great', 'Xun', 'Dui'],
  [29, '坎', 'Kǎn', 'The Abysmal (Water)', 'Kan', 'Kan'],
  [30, '離', 'Lí', 'The Clinging (Fire)', 'Li', 'Li'],
  [31, '咸', 'Xián', 'Influence (Wooing)', 'Gen', 'Dui'],
  [32, '恆', 'Héng', 'Duration', 'Xun', 'Zhen'],
  [33, '遯', 'Dùn', 'Retreat', 'Gen', 'Qian'],
  [34, '大壯', 'Dà Zhuàng', 'The Power of the Great', 'Qian', 'Zhen'],
  [35, '晉', 'Jìn', 'Progress', 'Kun', 'Li'],
  [36, '明夷', 'Míng Yí', 'Darkening of the Light', 'Li', 'Kun'],
  [37, '家人', 'Jiā Rén', 'The Family (The Clan)', 'Li', 'Xun'],
  [38, '睽', 'Kuí', 'Opposition', 'Dui', 'Li'],
  [39, '蹇', 'Jiǎn', 'Obstruction', 'Gen', 'Kan'],
  [40, '解', 'Xiè', 'Deliverance', 'Kan', 'Zhen'],
  [41, '損', 'Sǔn', 'Decrease', 'Dui', 'Gen'],
  [42, '益', 'Yì', 'Increase', 'Zhen', 'Xun'],
  [43, '夬', 'Guài', 'Breakthrough (Resoluteness)', 'Qian', 'Dui'],
  [44, '姤', 'Gòu', 'Coming to Meet', 'Xun', 'Qian'],
  [45, '萃', 'Cuì', 'Gathering Together', 'Kun', 'Dui'],
  [46, '升', 'Shēng', 'Pushing Upward', 'Xun', 'Kun'],
  [47, '困', 'Kùn', 'Oppression (Exhaustion)', 'Kan', 'Dui'],
  [48, '井', 'Jǐng', 'The Well', 'Xun', 'Kan'],
  [49, '革', 'Gé', 'Revolution (Molting)', 'Li', 'Dui'],
  [50, '鼎', 'Dǐng', 'The Cauldron', 'Xun', 'Li'],
  [51, '震', 'Zhèn', 'The Arousing (Thunder)', 'Zhen', 'Zhen'],
  [52, '艮', 'Gèn', 'Keeping Still (Mountain)', 'Gen', 'Gen'],
  [53, '漸', 'Jiàn', 'Development (Gradual Progress)', 'Gen', 'Xun'],
  [54, '歸妹', 'Guī Mèi', 'The Marrying Maiden', 'Dui', 'Zhen'],
  [55, '豐', 'Fēng', 'Abundance (Fullness)', 'Li', 'Zhen'],
  [56, '旅', 'Lǚ', 'The Wanderer', 'Gen', 'Li'],
  [57, '巽', 'Xùn', 'The Gentle (Wind)', 'Xun', 'Xun'],
  [58, '兌', 'Duì', 'The Joyous (Lake)', 'Dui', 'Dui'],
  [59, '渙', 'Huàn', 'Dispersion (Dissolution)', 'Kan', 'Xun'],
  [60, '節', 'Jié', 'Limitation', 'Dui', 'Kan'],
  [61, '中孚', 'Zhōng Fú', 'Inner Truth', 'Dui', 'Xun'],
  [62, '小過', 'Xiǎo Guò', 'Preponderance of the Small', 'Gen', 'Zhen'],
  [63, '既濟', 'Jì Jì', 'After Completion', 'Li', 'Kan'],
  [64, '未濟', 'Wèi Jì', 'Before Completion', 'Kan', 'Li'],
]

/** All 64 hexagrams in King Wen order (`HEXAGRAMS[0]` is #1, The Creative). */
export const HEXAGRAMS: readonly Hexagram[] = Object.freeze(
  ROWS.map(([kingWen, zh, pinyin, en, lowerKey, upperKey]) => {
    const lower = TRIGRAMS[lowerKey]
    const upper = TRIGRAMS[upperKey]
    return Object.freeze({
      kingWen,
      character: String.fromCodePoint(0x4dc0 + kingWen - 1),
      name: Object.freeze({ zh, pinyin, en }),
      binary: lower.bits + upper.bits,
      lower,
      upper,
    })
  }),
)

const BY_BINARY: ReadonlyMap<string, Hexagram> = new Map(HEXAGRAMS.map((h) => [h.binary, h]))

/**
 * Look up a hexagram by its six-bit line string (bottom → top, yang = 1) —
 * the same key shape the mindpeeker frontend's `hexagrams.json` uses.
 *
 * @throws never — returns `undefined` for anything that is not a six-bit string
 */
export function hexagramFromBinary(binary: string): Hexagram | undefined {
  return BY_BINARY.get(binary)
}
