// Client-only word library for the oracle: a bundled fallback plus a real
// English + German library fetched at runtime (both CORS-enabled raw files).

export const WORDS: readonly string[] = [
  'light', 'shadow', 'water', 'fire', 'earth', 'wind', 'spirit', 'silence', 'wisdom', 'chaos',
  'order', 'love', 'truth', 'dream', 'vision', 'mirror', 'threshold', 'journey', 'origin', 'cipher',
  'signal', 'pattern', 'chance', 'fate', 'gateway', 'anchor', 'compass', 'lantern', 'river', 'ocean',
  'star', 'moon', 'eclipse', 'dawn', 'thunder', 'crystal', 'ember', 'seed', 'bloom', 'memory',
  'echo', 'pulse', 'breath', 'resonance', 'balance', 'stillness', 'riddle', 'key', 'tower', 'flame',
  'oracle', 'phoenix', 'raven', 'serpent', 'lotus', 'amber', 'onyx', 'pearl',
]

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
