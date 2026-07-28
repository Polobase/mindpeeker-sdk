// A small Latin-alphabet word list for the gematria entropy oracle — evocative
// English words so a draw reads like a one-word reading. Values are computed
// under whichever cipher the caller selects, so the list is script-neutral.

export const WORDS: readonly string[] = [
  'light',
  'shadow',
  'water',
  'fire',
  'earth',
  'wind',
  'spirit',
  'silence',
  'wisdom',
  'chaos',
  'order',
  'love',
  'truth',
  'dream',
  'vision',
  'mirror',
  'threshold',
  'journey',
  'return',
  'origin',
  'cipher',
  'signal',
  'noise',
  'pattern',
  'chance',
  'fate',
  'north',
  'south',
  'gateway',
  'anchor',
  'compass',
  'lantern',
  'ember',
  'river',
  'mountain',
  'forest',
  'ocean',
  'star',
  'moon',
  'sun',
  'eclipse',
  'dawn',
  'dusk',
  'thunder',
  'crystal',
  'iron',
  'gold',
  'ash',
  'seed',
  'root',
  'bloom',
  'harvest',
  'memory',
  'echo',
  'pulse',
  'breath',
  'resonance',
  'harmony',
  'tension',
  'release',
  'balance',
  'motion',
  'stillness',
  'question',
  'answer',
  'riddle',
  'key',
  'lock',
  'door',
  'bridge',
  'tower',
  'well',
  'flame',
  'frost',
  'storm',
  'calm',
  'depth',
  'height',
  'center',
  'edge',
  'weave',
  'thread',
  'knot',
  'circle',
  'spiral',
  'cross',
  'wheel',
  'axis',
  'field',
  'grove',
  'hearth',
  'omen',
  'token',
  'relic',
  'charm',
  'oracle',
  'augur',
  'phoenix',
  'raven',
  'serpent',
  'wolf',
  'stag',
  'hawk',
  'lotus',
  'willow',
  'cedar',
  'amber',
  'onyx',
  'pearl',
  'jade',
]

// A larger, real English + German word library fetched at runtime (cached). Both
// files are public and CORS-enabled (access-control-allow-origin: *), so they
// load directly in the browser; on any failure the oracle falls back to WORDS.
//   English: first20hours/google-10000-english (10k common words, one per line)
//   German:  hermitdave/FrequencyWords de_50k ("word count" per line)
const EN_URL =
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt'
const DE_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt'

const WORD_RE = /^[a-zäöüß]+$/
let cache: Promise<readonly string[]> | undefined

async function fetchList(url: string, hasCount: boolean, take: number): Promise<string[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const out: string[] = []
  for (const line of (await res.text()).split('\n')) {
    const word = (hasCount ? (line.split(' ')[0] ?? '') : line).trim().toLowerCase()
    if (word.length >= 4 && WORD_RE.test(word)) out.push(word)
    if (out.length >= take) break
  }
  return out
}

/**
 * The EN+DE word library for the oracle, fetched once and cached. Skips each
 * language's ~120 most frequent (function) words for more evocative draws;
 * falls back to the bundled {@link WORDS} if the network is unavailable.
 */
export function loadWordLibrary(): Promise<readonly string[]> {
  if (!cache) {
    cache = Promise.all([fetchList(EN_URL, false, 6000), fetchList(DE_URL, true, 6000)])
      .then(([en, de]) => {
        const merged = [...new Set([...en.slice(120), ...de.slice(120)])]
        return merged.length > 200 ? merged : WORDS
      })
      .catch(() => WORDS)
  }
  return cache
}
